import { describe, expect, it } from "vitest";
import { assessGraduation, curveMaxBaseOut, curveTotalQuote, deltaBase, destinationAmounts, isQuarantined, Q128, type ReadinessInput } from "./readiness";

const Q64 = 1n << 64n;
// A single-segment curve from price 1e-9 to 4e-9 (quote per base, raw units).
const start = Q64 / 31623n; // sqrt(1e-9) ≈ 1/31623
const end = start * 2n; // price × 4
const L = 10n ** 18n * Q64; // arbitrary liquidity

const base = (over: Partial<ReadinessInput> = {}): ReadinessInput => {
  const sold = curveMaxBaseOut(start, [{ lowerSqrtPrice: start, upperSqrtPrice: end, liquidity: L }]);
  const range = { postMigrationSqrtMinPrice: start, postMigrationSqrtMaxPrice: end * 2n };
  const poolL = L / 4n;
  const dest = destinationAmounts({ migrationMode: 0, ...range }, end, poolL);
  return {
    totalSupply: sold + dest.base,
    startSqrtPrice: start,
    segments: [{ lowerSqrtPrice: start, upperSqrtPrice: end, liquidity: L }],
    migrationMode: 0,
    migrationQuoteThreshold: curveTotalQuote(start, [{ lowerSqrtPrice: start, upperSqrtPrice: end, liquidity: L }]),
    migrationBaseThreshold: 0n,
    migrationQuoteFeeBps: 0,
    postMigrationLiquidity: poolL,
    lockedBaseTotal: 0n,
    collectFeeInQuote: true,
    ...range,
    ...over,
  };
};

describe("graduation readiness", () => {
  it("passes when supply covers the curve plus the derived pool deposit", () => {
    const r = assessGraduation(base());
    expect(r.verdict).toBe("ready");
    expect(r.numbers.baseShortfall).toBe(0n);
  });

  it("fails the Config #6 shape: zero threshold, curve sells the whole supply", () => {
    const input = base();
    const r = assessGraduation({ ...input, totalSupply: r0(input) });
    expect(r.verdict).toBe("blocked");
    expect(r.checks.find((c) => c.id === "base-inventory")?.status).toBe("fail");
    expect(r.numbers.baseShortfall).toBe(r.numbers.grossMigrationBase);
  });

  it("counts locked vesting against the inventory", () => {
    const r = assessGraduation(base({ lockedBaseTotal: 1n }));
    expect(r.numbers.baseShortfall).toBe(1n);
  });

  it("rejects a non-zero base threshold that differs from the derived deposit", () => {
    const input = base();
    const deposit = assessGraduation(input).numbers.grossMigrationBase;
    const r = assessGraduation({ ...input, migrationBaseThreshold: deposit - 1n, totalSupply: input.totalSupply + 10n });
    expect(r.checks.find((c) => c.id === "base-pairing")?.status).toBe("fail");
  });

  it("flags an unreachable quote target", () => {
    const r = assessGraduation(base({ migrationQuoteThreshold: 10n ** 40n }));
    expect(r.checks.find((c) => c.id === "threshold-reachable")?.status).toBe("fail");
  });

  it("uses the live sqrt price and reserve for an in-progress curve", () => {
    const input = base();
    const fresh = assessGraduation(input);
    const mid = (start + end) / 2n;
    const soldSoFar = deltaBase(start, mid, L, false);
    const live = assessGraduation(input, { baseReserveNow: input.totalSupply - soldSoFar, sqrtPriceNow: mid });
    const diff = fresh.numbers.curveSold - soldSoFar - live.numbers.curveSold;
    expect(diff >= -1n && diff <= 1n).toBe(true);
    expect(live.verdict).toBe("ready");
  });

  it("compounding destination uses ceil(L / sqrtP) and ceil(L * sqrtP / 2^128)", () => {
    const d = destinationAmounts({ migrationMode: 1, postMigrationSqrtMinPrice: 0n, postMigrationSqrtMaxPrice: 0n }, 3n, 10n);
    expect(d.base).toBe(4n);
    expect(d.quote).toBe((10n * 3n + Q128 - 1n) / Q128);
  });

  it("knows the quarantined identity", () => {
    expect(isQuarantined(91342, "0x6d043014972b87406C4757a5f2d655A24e0b0aF9", 6n, "0x00")).toBe(true);
    expect(isQuarantined(91342, "0x6d043014972b87406C4757a5f2d655A24e0b0aF9", 10n, "0x00")).toBe(false);
  });
});

function r0(input: ReadinessInput) {
  return curveMaxBaseOut(input.startSqrtPrice, input.segments);
}
