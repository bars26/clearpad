import {
  createWalletClient,
  custom,
  encodeFunctionData,
  erc20Abi,
  formatEther,
  type Abi,
  numberToHex,
  parseAbi,
  type Address,
  type EIP1193Provider,
  type Hash,
  type WalletClient,
} from "viem";
import {
  buildCreateAmmoraV4Launch,
  classifyAmmoraV4ExactInputFill,
  parseAmmoraV4LaunchCreatedReceipt,
} from "@ammora-protocol/sdk";
import { deployment, giwaSepolia, publicClient } from "./rpc";
import { curveClient, loadConfig, shortError } from "./launch";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

export const WETH = deployment.contracts.tokens.wrappedNative as Address;
const wethAbi = parseAbi(["function deposit() payable", "function withdraw(uint256)"]);

export type Wallet = { address: Address; client: WalletClient };

export const connectWallet = async (): Promise<Wallet> => {
  const provider = window.ethereum;
  if (!provider) throw new Error("No browser wallet found. Install MetaMask or Rabby.");
  const [address] = (await provider.request({ method: "eth_requestAccounts" })) as Address[];
  if (!address) throw new Error("The wallet returned no account.");
  await ensureChain(provider);
  return { address, client: createWalletClient({ account: address, chain: giwaSepolia, transport: custom(provider) }) };
};

/**
 * Reconnects silently on page load if the wallet already granted this site
 * access (eth_accounts never opens a prompt). Returns undefined otherwise.
 */
export const restoreWallet = async (): Promise<Wallet | undefined> => {
  const provider = window.ethereum;
  if (!provider) return undefined;
  const [address] = ((await provider.request({ method: "eth_accounts" })) as Address[]) ?? [];
  if (!address) return undefined;
  return { address, client: createWalletClient({ account: address, chain: giwaSepolia, transport: custom(provider) }) };
};

/** Calls back with the new wallet (or undefined) whenever the account changes. */
export const onAccountsChanged = (cb: (w: Wallet | undefined) => void) => {
  const provider = window.ethereum as (EIP1193Provider & { removeListener?: (e: string, f: () => void) => void }) | undefined;
  if (!provider?.on) return () => {};
  const handler = () => void restoreWallet().then(cb, () => cb(undefined));
  provider.on("accountsChanged", handler);
  return () => provider.removeListener?.("accountsChanged", handler);
};

const ensureChain = async (provider: EIP1193Provider) => {
  const chainId = numberToHex(giwaSepolia.id);
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch (error) {
    if ((error as { code?: number }).code !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId,
          chainName: giwaSepolia.name,
          nativeCurrency: giwaSepolia.nativeCurrency,
          rpcUrls: giwaSepolia.rpcUrls.default.http,
          blockExplorerUrls: [giwaSepolia.blockExplorers!.default.url],
        },
      ],
    });
  }
};

const send = async (w: Wallet, tx: { to: Address; data?: `0x${string}`; value?: bigint }) => {
  // Simulate first: a revert is shown to the user instead of a wallet prompt.
  await publicClient.call({ account: w.address, to: tx.to, data: tx.data, value: tx.value });
  // A silently restored wallet may sit on another network; switch before signing.
  if (window.ethereum) await ensureChain(window.ethereum);
  const hash = await w.client.sendTransaction({ account: w.address, chain: giwaSepolia, to: tx.to, data: tx.data, value: tx.value });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 2_000, timeout: 180_000 });
  if (receipt.status !== "success") throw new Error(`Transaction reverted: ${hash}`);
  return { hash, receipt };
};

export const balances = async (owner: Address, token?: Address) => {
  const [eth, weth, base] = await Promise.all([
    publicClient.getBalance({ address: owner }),
    publicClient.readContract({ address: WETH, abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
    token ? publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [owner] }) : Promise.resolve(0n),
  ]);
  return { eth, weth, base };
};

export const wrapEth = (w: Wallet, amount: bigint) =>
  send(w, { to: WETH, data: encode(wethAbi, "deposit", []), value: amount });

const encode = (abi: Abi, functionName: string, args: readonly unknown[]) =>
  encodeFunctionData({ abi, functionName, args } as never);

export type CreateInput = { configId: bigint; name: string; symbol: string; metadataURI: string };

/**
 * Re-reads the Config live and refuses to request a signature unless the
 * graduation check passes at this block. Then simulates and sends.
 */
export const createLaunch = async (w: Wallet, input: CreateInput, onStep: (step: string) => void) => {
  onStep("Re-checking the Config on-chain");
  const view = await loadConfig(input.configId);
  if (view.readiness.verdict !== "ready") {
    const failed = view.readiness.checks.filter((c) => c.status === "fail").map((c) => c.title);
    throw new Error(`Blocked before signing: ${failed.join("; ")}`);
  }
  const tx = buildCreateAmmoraV4Launch(
    {
      name: input.name,
      symbol: input.symbol,
      metadataURI: input.metadataURI,
      creatorMetadataURI: input.metadataURI,
      tokenDecimals: view.snapshot.config.tokenDecimals,
    },
    input.configId,
    view.snapshot.config.poolCreationFee,
  );
  onStep("Simulating, then waiting for your wallet");
  const { hash, receipt } = await send(w, { to: deployment.contracts.launch.factory, data: tx.data, value: tx.value });
  const created = parseAmmoraV4LaunchCreatedReceipt(receipt, deployment.contracts.launch.factory);
  return { hash, token: created.token as Address, curve: created.curve as Address };
};

export type TradeQuote = {
  amountIn: bigint;
  amountOut: bigint;
  amountLeft: bigint;
  fee: bigint;
  fill: ReturnType<typeof classifyAmmoraV4ExactInputFill>;
};

export const quoteTrade = async (curve: Address, amountIn: bigint, sell: boolean): Promise<TradeQuote> => {
  const q = await curveClient(curve).quoteExactInput(amountIn, sell);
  return { amountIn: q.amountIn, amountOut: q.amountOut, amountLeft: q.amountLeft, fee: q.fee, fill: classifyAmmoraV4ExactInputFill(q, sell) };
};

export const trade = async (
  w: Wallet,
  curve: Address,
  amountIn: bigint,
  sell: boolean,
  slippageBps: number,
  onStep: (step: string) => void,
): Promise<Hash> => {
  const client = curveClient(curve);
  const fresh = await client.quoteExactInput(amountIn, sell);
  const fill = classifyAmmoraV4ExactInputFill(fresh, sell);
  if (fill.kind === "terminal-dust") throw new Error("The curve is at its final dust amount; this trade would receive nothing.");
  if (fill.kind === "partial" && !fill.allowPartialFill) throw new Error("This sell would only partially fill. Lower the amount.");
  const plan = await client.planSwapExactInput({
    includedAmountIn: amountIn,
    baseForQuote: sell,
    allowPartialFill: fill.allowPartialFill,
    slippageBps,
    recipient: w.address,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
  });
  const need = plan.approvalRequirement;

  // The curve pulls the input token with transferFrom; a missing balance only
  // surfaces as an opaque revert, so check it first and explain.
  const held = await publicClient.readContract({ address: need.token, abi: erc20Abi, functionName: "balanceOf", args: [w.address] });
  if (held < amountIn) {
    if (sell) throw new Error("You don't hold that many tokens. Lower the amount.");
    if (need.token.toLowerCase() !== WETH.toLowerCase()) throw new Error("Not enough of the quote token for this buy.");
    const shortfall = amountIn - held;
    const eth = await publicClient.getBalance({ address: w.address });
    if (eth <= shortfall) throw new Error("Not enough ETH to wrap into WETH for this buy (keep a little ETH for gas).");
    onStep(`Wrap ${formatEther(shortfall)} ETH → WETH in your wallet`);
    await wrapEth(w, shortfall);
  }

  const allowance = await publicClient.readContract({ address: need.token, abi: erc20Abi, functionName: "allowance", args: [w.address, need.spender] });
  if (allowance < need.amount) {
    onStep("Approve the exact amount in your wallet");
    await send(w, { to: need.token, data: encode(erc20Abi, "approve", [need.spender, need.amount]) });
  }
  onStep(fill.kind === "graduation-boundary" ? "Final fill: the unused amount is returned" : "Confirm the trade in your wallet");
  const { hash } = await send(w, { to: plan.transaction.to, data: plan.transaction.data, value: plan.transaction.value });
  return hash;
};

export const graduate = async (w: Wallet, curve: Address, onStep: (step: string) => void) => {
  onStep("Simulating migrate()");
  const block = await publicClient.getBlockNumber();
  const plan = await curveClient(curve).planMigrateAtBlock(block);
  onStep("Confirm graduation in your wallet");
  const { hash } = await send(w, plan.transaction);
  return hash;
};

export { shortError };
