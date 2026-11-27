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
 * The public GIWA RPC counts every eth_call, and the SDK fans reads out with
 * Promise.all. Serialize requests with a minimum gap and back off on 429.
 * Only reads go through here: wallet writes use the user's own provider.
 */
export const pacedHttp = (url = RPC_URL, intervalMs = 220): Transport => {
  let tail: Promise<unknown> = Promise.resolve();
  let nextStart = 0;
  return (parameters) => {
    const base = http(url, { retryCount: 0 })(parameters);
    return custom(
      {
        request: (args) => {
          const run = tail.then(async () => {
            for (let attempt = 0; ; attempt++) {
              await sleep(Math.max(0, nextStart - Date.now()));
              try {
                return await base.request(args);
              } catch (error) {
                if (!isRateLimit(error) || attempt >= 5) throw error;
                nextStart = Date.now() + 1000 * 2 ** attempt;
                continue;
              } finally {
                if (nextStart < Date.now() + intervalMs) nextStart = Date.now() + intervalMs;
              }
            }
          });
          tail = run.catch(() => undefined);
          return run;
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
