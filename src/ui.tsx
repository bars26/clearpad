import { formatUnits } from "viem";
import { useEffect, useState, type ReactNode } from "react";
import type { Check } from "./lib/readiness";
import { EXPLORER } from "./lib/rpc";

export const fmt = (raw: bigint | string, decimals: number, digits = 4) => {
  const value = Number(formatUnits(BigInt(raw), decimals));
  if (value === 0) return "0";
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return value.toLocaleString("en-US", { maximumSignificantDigits: digits });
};

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export const AddressLink = ({ address, label }: { address: string; label?: string }) => (
  <a className="mono" href={`${EXPLORER}/address/${address}`} target="_blank" rel="noreferrer">
    {label ?? short(address)}
  </a>
);

export const TxLink = ({ hash }: { hash: string }) => (
  <a className="mono" href={`${EXPLORER}/tx/${hash}`} target="_blank" rel="noreferrer">
    {short(hash)}
  </a>
);

const ICON: Record<Check["status"], string> = { pass: "✓", fail: "✕", warn: "!" };

export const CheckList = ({ checks }: { checks: Check[] }) => (
  <ul className="checks">
    {checks.map((c, i) => (
      <li key={c.id} className={`check ${c.status}`} style={{ animationDelay: `${i * 70}ms` }}>
        <span className="check-icon" aria-label={c.status}>
          {ICON[c.status]}
        </span>
        <div>
          <strong>{c.title}</strong>
          <p>{c.detail}</p>
        </div>
      </li>
    ))}
  </ul>
);

export const Verdict = ({ ok, children }: { ok: boolean; children?: ReactNode }) => (
  <span className={`verdict ${ok ? "ok" : "bad"}`}>
    <i aria-hidden />
    {children ?? (ok ? "Can graduate" : "Cannot graduate")}
  </span>
);

export const Progress = ({ bps }: { bps: number }) => (
  <div className="progress" role="progressbar" aria-valuenow={bps / 100} aria-valuemin={0} aria-valuemax={100}>
    <div style={{ width: `${Math.min(100, bps / 100)}%` }} />
  </div>
);

export const Notice = ({ kind, children }: { kind: "error" | "info" | "ok"; children: ReactNode }) => (
  <div className={`notice ${kind}`}>{children}</div>
);

/** Circular progress gauge. `tone` colors the arc. */
export const Ring = ({
  bps,
  size = 52,
  stroke = 5,
  tone = "aurora",
  label,
}: {
  bps: number;
  size?: number;
  stroke?: number;
  tone?: "aurora" | "bad" | "done";
  label?: ReactNode;
}) => {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, bps / 10_000));
  const gid = `ring-${tone}`;
  return (
    <div className={`ring ring-${tone}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <defs>
          <linearGradient id="ring-aurora" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#7938FB" />
            <stop offset="0.5" stopColor="#49C9F4" />
            <stop offset="1" stopColor="#66F3AC" />
          </linearGradient>
          <linearGradient id="ring-bad" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#FF6B8B" />
            <stop offset="1" stopColor="#FF9F6B" />
          </linearGradient>
          <linearGradient id="ring-done" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#49C9F4" />
            <stop offset="1" stopColor="#66F3AC" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--track)" strokeWidth={stroke} />
        <circle
          className="ring-arc"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#${gid})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="ring-label">{label ?? `${Math.round(pct * 100)}%`}</span>
    </div>
  );
};

/**
 * Stylised bonding curve: price rises with tokens sold; a dot marks where the
 * launch is now and the flag marks the graduation target. A blocked launch
 * draws a broken bridge after the flag.
 */
export const CurveChart = ({ bps, blocked, done }: { bps: number; blocked: boolean; done: boolean }) => {
  const W = 520;
  const H = 180;
  const pad = 18;
  const x0 = pad;
  const x1 = W * 0.78;
  const y0 = H - pad;
  const y1 = pad + 18;
  const pt = (t: number) => {
    const x = x0 + (x1 - x0) * t;
    const y = y0 - (y0 - y1) * Math.pow(t, 2.1);
    return [x, y] as const;
  };
  const path = Array.from({ length: 41 }, (_, i) => pt(i / 40))
    .map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");
  const t = Math.max(0, Math.min(1, bps / 10_000));
  const [dx, dy] = pt(t);
  const filled = Array.from({ length: Math.max(2, Math.round(t * 40) + 1) }, (_, i) => pt((i / Math.max(1, Math.round(t * 40))) * t));
  const area = `${filled.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ")} L${dx.toFixed(1)} ${y0} L${x0} ${y0} Z`;
  const [fx, fy] = pt(1);
  return (
    <svg className="curve-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Curve ${Math.round(t * 100)}% to graduation`}>
      <defs>
        <linearGradient id="cc-line" x1="0" x2="1">
          <stop offset="0" stopColor="#7938FB" />
          <stop offset="0.55" stopColor="#666DFB" />
          <stop offset="1" stopColor="#49C9F4" />
        </linearGradient>
        <linearGradient id="cc-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#666DFB" stopOpacity="0.45" />
          <stop offset="1" stopColor="#666DFB" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((g) => (
        <line key={g} x1={x0} x2={W - pad} y1={y0 - (y0 - y1) * g} y2={y0 - (y0 - y1) * g} className="cc-grid" />
      ))}
      <line x1={x0} x2={W - pad} y1={y0} y2={y0} className="cc-axis" />
      <path d={area} fill="url(#cc-fill)" />
      <path d={path} fill="none" stroke="var(--track-strong)" strokeWidth="3" strokeLinecap="round" />
      <path d={path} fill="none" stroke="url(#cc-line)" strokeWidth="3.5" strokeLinecap="round" strokeDasharray="1000" strokeDashoffset={1000 - 1000 * t} className="cc-progress" />
      {/* finish flag */}
      <line x1={fx} x2={fx} y1={y0} y2={fy - 14} className="cc-flag-pole" />
      <path d={`M${fx} ${fy - 14} l16 5 l-16 5 z`} className={blocked ? "cc-flag bad" : "cc-flag"} />
      {/* after graduation: pool or a broken bridge */}
      {blocked ? (
        <g className="cc-broken">
          <path d={`M${fx + 6} ${fy + 6} l22 0`} />
          <path d={`M${fx + 46} ${fy + 6} l${W - pad - fx - 46} 0`} />
          <text x={fx + 32} y={fy - 4}>✕</text>
          <text x={fx + 6} y={fy + 26} className="cc-note">pool short of tokens</text>
        </g>
      ) : (
        <g className="cc-pool">
          <path d={`M${fx + 6} ${fy + 6} L${W - pad} ${fy + 6}`} />
          <text x={fx + 6} y={fy + 26} className="cc-note">{done ? "trading in pool" : "graduated pool"}</text>
        </g>
      )}
      <circle cx={dx} cy={dy} r="11" className="cc-halo" />
      <circle cx={dx} cy={dy} r="6" className="cc-dot" />
      <text x={x0} y={H - 2} className="cc-note">
        tokens sold →
      </text>
    </svg>
  );
};

/** Side-by-side bars: tokens left after sell-out vs what the pool needs. */
export const InventoryBars = ({
  left,
  need,
  label,
}: {
  left: bigint;
  need: bigint;
  label: (v: bigint) => string;
}) => {
  const max = left > need ? left : need;
  const w = (v: bigint) => (max === 0n ? 0 : Number((v * 1000n) / max) / 10);
  const ok = left >= need;
  return (
    <div className="inv">
      <div className="inv-row">
        <span>Left after sell-out</span>
        <div className="inv-track">
          <div className={`inv-bar ${ok ? "ok" : "bad"}`} style={{ width: `${Math.max(w(left), 0.6)}%` }} />
        </div>
        <b>{label(left)}</b>
      </div>
      <div className="inv-row">
        <span>Pool + locks need</span>
        <div className="inv-track">
          <div className="inv-bar need" style={{ width: `${Math.max(w(need), 0.6)}%` }} />
        </div>
        <b>{label(need)}</b>
      </div>
    </div>
  );
};

/** Counts up to `value` once on mount. */
export const CountUp = ({ value, ms = 900 }: { value: number; ms?: number }) => {
  const [n, setN] = useState(0);
  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return setN(value);
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      setN(Math.round(value * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return <>{n.toLocaleString("en-US")}</>;
};

/** Deterministic gradient avatar from the token address. */
export const Avatar = ({ seed, symbol, className = "avatar" }: { seed: string; symbol: string; className?: string }) => {
  let h = 0;
  for (const ch of seed.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  // Stay inside the violet → cyan → mint family.
  const a = 200 + (h % 140);
  const b = (a + 40 + ((h >> 8) % 60)) % 360;
  return (
    <span
      className={className}
      style={{ background: `linear-gradient(135deg, hsl(${a} 85% 62%), hsl(${b} 80% 55%))` }}
      aria-hidden
    >
      {(symbol || "?").slice(0, 2).toUpperCase()}
    </span>
  );
};
