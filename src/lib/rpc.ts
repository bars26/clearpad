import { createPublicClient, custom, defineChain, http, type PublicClient, type Transport } from "viem";
import { giwaSepoliaAutoRouteDeployment as deployment } from "@ammora-protocol/sdk";

export { deployment };
export const RPC_URL = deployment.chain.rpcUrls[0];
export const EXPLORER = deployment.chain.blockExplorerUrl;

export const giwaSepolia = defineChain({
  id: deployment.chain.id,
  name: deployment.chain.name,
  nativeCurrency: deployment.chain.nativeCurrency,
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: "GIWA Explorer", url: EXPLORER } },
  // Standard Multicall3 deployment; present on GIWA Sepolia (OP Stack predeploy set).
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const isRateLimit = (error: unknown) => /\b429\b|rate limit|over rate/i.test(String((error as Error)?.message ?? error));

/**
 * The public GIWA RPC rate-limits floods but handles a few parallel calls well
 * (8 concurrent ran without a 429 in testing). Allow `maxInFlight` requests at
 * once and, on a 429, pause every new request with exponential backoff.
 * Only reads go through here: wallet writes use the user's own provider.
 */
export const pacedHttp = (url = RPC_URL, maxInFlight = 4): Transport => {
  let inFlight = 0;
  let pausedUntil = 0;
  const waiters: (() => void)[] = [];
  const acquire = async () => {
    while (inFlight >= maxInFlight) await new Promise<void>((r) => waiters.push(r));
    inFlight++;
  };
  const release = () => {
    inFlight--;
    waiters.shift()?.();
  };
  return (parameters) => {
    const base = http(url, { retryCount: 0 })(parameters);
    return custom(
      {
        request: async (args) => {
          for (let attempt = 0; ; attempt++) {
            await acquire();
            try {
              const wait = pausedUntil - Date.now();
              if (wait > 0) await sleep(wait);
              return await base.request(args);
            } catch (error) {
              if (!isRateLimit(error) || attempt >= 5) throw error;
              pausedUntil = Math.max(pausedUntil, Date.now() + 750 * 2 ** attempt);
            } finally {
              release();
            }
          }
        },
      },
      { retryCount: 0 },
    )(parameters);
  };
};

// Reads issued in the same tick (the SDK's Promise.all fan-outs) are folded into
// one Multicall3 eth_call per block, which keeps a page load to a handful of requests.
export const publicClient = createPublicClient({
  chain: giwaSepolia,
  transport: pacedHttp(),
  batch: { multicall: { wait: 16 } },
}) as PublicClient;
