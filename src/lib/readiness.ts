/**
 * Graduation readiness, mirrored from the verified ALCSegmentedPoolV4.migrate()
 * source on GIWA Sepolia (curve implementation 0x0141…C031).
 *
 * migrate() reverts with MigrationNotReady unless, at the moment the curve is
 * ReadyToMigrate:
 *   baseForMigration + lockedTotal <= baseReserve
 *   baseForMigration == grossBaseAmount
 *   quoteReserve - quoteMigrationFee >= grossQuoteAmount
 * where (grossBase, grossQuote) = destination amounts for postMigrationLiquidity
 * at migrationSqrtPrice (= last curve segment's upper sqrt price), rounded up.
 *
 * Everything here is integer math on raw units. No floating point.
 */

export const Q128 = 1n << 128n;
export const BPS = 10_000n;

/** Config #6 on the auto-route registry: publicly quarantined by Ammora. */
export const QUARANTINED = [
  {
    chainId: 91342,
    registry: "0x6d043014972b87406c4757a5f2d655a24e0b0af9",
    configId: 6n,
    configHash: "0x6048908774397e0691bb0e19f72dabb790eb0d892d6081d3622b39e7f738e667",
  },
] as const;

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
const mulDiv = (a: bigint, b: bigint, d: bigint, up: boolean) => (up ? ceilDiv(a * b, d) : (a * b) / d);

/** AmmoraSqrtPriceMath.deltaBase */
export const deltaBase = (lower: bigint, upper: bigint, liquidity: bigint, up: boolean) =>
  mulDiv(liquidity, upper - lower, lower * upper, up);

/** AmmoraSqrtPriceMath.deltaQuote */
export const deltaQuote = (lower: bigint, upper: bigint, liquidity: bigint, up: boolean) =>
  mulDiv(liquidity, upper - lower, Q128, up);

export type Segment = { lowerSqrtPrice: bigint; upperSqrtPrice: bigint; liquidity: bigint };

export type ReadinessInput = {
  totalSupply: bigint;
  startSqrtPrice: bigint;
  segments: readonly Segment[];
  migrationMode: number; // 0 = concentrated, 1 = compounding
  migrationQuoteThreshold: bigint;
  migrationBaseThreshold: bigint;
  migrationQuoteFeeBps: number;
  postMigrationLiquidity: bigint;
  postMigrationSqrtMinPrice: bigint;
  postMigrationSqrtMaxPrice: bigint;
  lockedBaseTotal: bigint;
  collectFeeInQuote: boolean;
};

/** Max base the curve can sell from startSqrtPrice to the last segment's upper bound. */
export const curveMaxBaseOut = (start: bigint, segments: readonly Segment[]) => {
  let total = 0n;
  for (const s of segments) {
    const lower = s.lowerSqrtPrice > start ? s.lowerSqrtPrice : start;
    if (lower >= s.upperSqrtPrice) continue;
    total += deltaBase(lower, s.upperSqrtPrice, s.liquidity, false);
  }
  return total;
};

/** Total quote the curve absorbs from start to its end (rounded up, as buys pay). */
export const curveTotalQuote = (start: bigint, segments: readonly Segment[]) => {
  let total = 0n;
  for (const s of segments) {
    const lower = s.lowerSqrtPrice > start ? s.lowerSqrtPrice : start;
    if (lower >= s.upperSqrtPrice) continue;
    total += deltaQuote(lower, s.upperSqrtPrice, s.liquidity, true);
  }
  return total;
};

/** ALCSegmentedPoolV4._destinationAmounts */
export const destinationAmounts = (
  input: Pick<ReadinessInput, "migrationMode" | "postMigrationSqrtMinPrice" | "postMigrationSqrtMaxPrice">,
  migrationSqrtPrice: bigint,
  liquidity: bigint,
): { base: bigint; quote: bigint } => {
  if (liquidity === 0n) throw new RangeError("postMigrationLiquidity is zero");
  if (input.migrationMode === 0) {
    const min = input.postMigrationSqrtMinPrice;
    const max = input.postMigrationSqrtMaxPrice;
    if (min === 0n || max <= min || migrationSqrtPrice < min || migrationSqrtPrice > max) {
      throw new RangeError("migration price is outside the concentrated destination range");
    }
    const base = migrationSqrtPrice === max ? 0n : deltaBase(migrationSqrtPrice, max, liquidity, true);
    const quote = migrationSqrtPrice === min ? 0n : deltaQuote(min, migrationSqrtPrice, liquidity, true);
    return { base, quote };
  }
  return { base: ceilDiv(liquidity, migrationSqrtPrice), quote: mulDiv(liquidity, migrationSqrtPrice, Q128, true) };
};

export type CheckStatus = "pass" | "fail" | "warn";
export type Check = { id: string; status: CheckStatus; title: string; detail: string };

export type Readiness = {
  verdict: "ready" | "blocked";
  checks: Check[];
  numbers: {
    curveSold: bigint;
    baseLeftAfterSale: bigint;
    grossMigrationBase: bigint;
    baseForMigration: bigint;
    lockedBase: bigint;
    baseShortfall: bigint;
    quoteAtMigration: bigint;
    quoteAfterFee: bigint;
    grossMigrationQuote: bigint;
    quoteShortfall: bigint;
    migrationSqrtPrice: bigint;
  };
};

/**
 * Predicts whether migrate() can succeed once the curve sells out.
 * `baseReserveNow`/`soldFromHere` let a live curve be checked from its current
 * reserves instead of from the Config's totalSupply.
 */
export const assessGraduation = (
  c: ReadinessInput,
  live?: { baseReserveNow: bigint; sqrtPriceNow: bigint },
): Readiness => {
  const checks: Check[] = [];
  const last = c.segments[c.segments.length - 1];
  if (!last) throw new RangeError("Config has no curve segments");
  const migrationSqrtPrice = last.upperSqrtPrice;

  const start = live ? live.sqrtPriceNow : c.startSqrtPrice;
  const curveSold = curveMaxBaseOut(start, c.segments);
  const reserve = live ? live.baseReserveNow : c.totalSupply;
  const baseLeftAfterSale = reserve > curveSold ? reserve - curveSold : 0n;

  let gross = { base: 0n, quote: 0n };
  let rangeOk = true;
  try {
    gross = destinationAmounts(c, migrationSqrtPrice, c.postMigrationLiquidity);
  } catch (error) {
    rangeOk = false;
    checks.push({
      id: "range",
      status: "fail",
      title: "Graduation pool range",
      detail: (error as Error).message,
    });
  }

  const baseForMigration = c.migrationBaseThreshold === 0n ? gross.base : c.migrationBaseThreshold;
  const needBase = baseForMigration + c.lockedBaseTotal;
  const baseShortfall = needBase > baseLeftAfterSale ? needBase - baseLeftAfterSale : 0n;

  // Quote reserve at migration: threshold mode caps it at the threshold (surplus is
  // claimed first); price mode takes everything the curve absorbed.
  const quoteAtMigration =
    c.migrationQuoteThreshold !== 0n ? c.migrationQuoteThreshold : curveTotalQuote(c.startSqrtPrice, c.segments);
  const quoteFee = (quoteAtMigration * BigInt(c.migrationQuoteFeeBps)) / BPS;
  const quoteAfterFee = quoteAtMigration - quoteFee;
  const quoteShortfall = gross.quote > quoteAfterFee ? gross.quote - quoteAfterFee : 0n;

  if (c.migrationQuoteThreshold !== 0n) {
    const absorbable = curveTotalQuote(c.startSqrtPrice, c.segments);
    const reachable = absorbable >= c.migrationQuoteThreshold;
    checks.push({
      id: "threshold-reachable",
      status: reachable ? "pass" : "fail",
      title: "Graduation target is reachable",
      detail: reachable
        ? "The whole curve can absorb at least the graduation target, so a sell-out triggers ReadyToMigrate."
        : "The curve tops out below the graduation target, so the launch can never become ReadyToMigrate.",
    });
  }

  if (rangeOk) {
    checks.push({
      id: "base-inventory",
      status: baseShortfall === 0n ? "pass" : "fail",
      title: "Enough tokens left for the graduation pool",
      detail:
        baseShortfall === 0n
          ? "After the curve sells out, the remaining tokens cover the pool deposit and every locked allocation."
          : "The curve can sell more tokens than the pool deposit leaves room for. migrate() would revert with MigrationNotReady and buyers' funds would stay inside the curve.",
    });
    const pairing = c.migrationBaseThreshold === 0n || c.migrationBaseThreshold === gross.base;
    checks.push({
      id: "base-pairing",
      status: pairing ? "pass" : "fail",
      title: "Pool deposit matches the stored base threshold",
      detail: pairing
        ? c.migrationBaseThreshold === 0n
          ? "Zero-threshold mode: the contract derives the deposit from the pool liquidity."
          : "The stored base threshold equals the derived pool deposit exactly."
        : "The stored base threshold differs from the derived pool deposit, so migrate() reverts.",
    });
    checks.push({
      id: "quote-budget",
      status: quoteShortfall === 0n ? "pass" : "fail",
      title: "Enough raised quote to seed the pool",
      detail:
        quoteShortfall === 0n
          ? "Raised quote after the migration fee covers the pool's quote side."
          : "Raised quote after the migration fee is below the pool's quote side.",
    });
  }

  return {
    verdict: checks.every((check) => check.status !== "fail") ? "ready" : "blocked",
    checks,
    numbers: {
      curveSold,
      baseLeftAfterSale,
      grossMigrationBase: gross.base,
      baseForMigration,
      lockedBase: c.lockedBaseTotal,
      baseShortfall,
      quoteAtMigration,
      quoteAfterFee,
      grossMigrationQuote: gross.quote,
      quoteShortfall,
      migrationSqrtPrice,
    },
  };
};

export const lockedTotal = (v: { cliffUnlockAmount: bigint; amountPerPeriod: bigint; numberOfPeriods: number }) =>
  v.cliffUnlockAmount + v.amountPerPeriod * BigInt(v.numberOfPeriods);

export const isQuarantined = (chainId: number, registry: string, configId: bigint, configHash: string) =>
  QUARANTINED.some(
    (q) =>
      q.chainId === chainId &&
      q.registry === registry.toLowerCase() &&
      (q.configId === configId || q.configHash === configHash.toLowerCase()),
  );
