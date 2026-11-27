import { formatUnits } from "viem";
import type { ReactNode } from "react";
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
    {checks.map((c) => (
      <li key={c.id} className={`check ${c.status}`}>
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
  <span className={`verdict ${ok ? "ok" : "bad"}`}>{children ?? (ok ? "Can graduate" : "Cannot graduate")}</span>
);

export const Progress = ({ bps }: { bps: number }) => (
  <div className="progress" role="progressbar" aria-valuenow={bps / 100} aria-valuemin={0} aria-valuemax={100}>
    <div style={{ width: `${Math.min(100, bps / 100)}%` }} />
  </div>
);

export const Notice = ({ kind, children }: { kind: "error" | "info" | "ok"; children: ReactNode }) => (
  <div className={`notice ${kind}`}>{children}</div>
);
