import { useEffect, useState } from "react";
import type { IndexFile } from "../lib/indexTypes";
import { loadConfig, shortError, type ConfigView } from "../lib/launch";
import { AddressLink, CheckList, Notice, Verdict, fmt } from "../ui";

export const Audit = ({ index }: { index?: IndexFile }) => {
  const selected = Number(window.location.hash.split("/")[2] ?? NaN);
  const [view, setView] = useState<ConfigView>();
  const [err, setErr] = useState<string>();

  useEffect(() => {
    if (!Number.isInteger(selected) || selected < 1) return;
    setView(undefined);
    setErr(undefined);
    loadConfig(BigInt(selected)).then(setView, (e) => setErr(shortError(e)));
  }, [selected]);

  if (!index) return <p className="muted">Loading…</p>;
  const configs = Object.values(index.configs).sort((a, b) => a.id - b.id);
  const launchesBy = new Map<number, number>();
  for (const l of index.launches) launchesBy.set(l.configId, (launchesBy.get(l.configId) ?? 0) + 1);
  const blocked = configs.filter((c) => c.verdict === "blocked");

  return (
    <>
      <h1>Config audit</h1>
      <p className="muted">
        Every Config on the auto-route registry <AddressLink address={index.registry} />, checked against the curve
        contract's <code>migrate()</code> conditions. {blocked.length} of {configs.length} cannot graduate;{" "}
        {blocked.filter((c) => c.enabled).length} of those are still enabled.
      </p>

      {Number.isInteger(selected) && selected > 0 && (
        <section className="panel">
          <h2>Config #{selected}</h2>
          {err && <Notice kind="error">{err}</Notice>}
          {!view && !err && <p className="muted">Reading live…</p>}
          {view && (
            <>
              <div className="row-between">
                <span className="muted">
                  Owner <AddressLink address={view.snapshot.identity.owner} /> · hash{" "}
                  <span className="mono">{view.snapshot.configHash.slice(0, 14)}…</span>
                </span>
                <Verdict ok={view.readiness.verdict === "ready"} />
              </div>
              <CheckList checks={[...view.readiness.checks, ...view.flags]} />
              <dl className="kv">
                <dt>Curve sells (worst case)</dt>
                <dd>{fmt(view.readiness.numbers.curveSold, view.snapshot.config.tokenDecimals)}</dd>
                <dt>Left after sell-out</dt>
                <dd>{fmt(view.readiness.numbers.baseLeftAfterSale, view.snapshot.config.tokenDecimals)}</dd>
                <dt>Pool deposit + locks</dt>
                <dd>
                  {fmt(
                    view.readiness.numbers.baseForMigration + view.readiness.numbers.lockedBase,
                    view.snapshot.config.tokenDecimals,
                  )}
                </dd>
                <dt>Quote after migration fee / needed</dt>
                <dd>
                  {fmt(view.readiness.numbers.quoteAfterFee, 18)} / {fmt(view.readiness.numbers.grossMigrationQuote, 18)}
                </dd>
              </dl>
            </>
          )}
        </section>
      )}

      <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Config</th>
            <th>Verdict</th>
            <th>Enabled</th>
            <th>Destination</th>
            <th>Target</th>
            <th>Shortfall</th>
            <th>Launches</th>
          </tr>
        </thead>
        <tbody>
          {configs.map((c) => (
            <tr key={c.id} className={c.verdict === "blocked" ? (c.enabled ? "row-bad" : "row-dim") : ""}>
              <td>
                <a href={`#/audit/${c.id}`}>#{c.id}</a>
              </td>
              <td>
                <Verdict ok={c.verdict === "ready"}>{c.verdict === "ready" ? "OK" : "Blocked"}</Verdict>
              </td>
              <td>{c.enabled ? "yes" : "no"}</td>
              <td>{c.migrationMode === 0 ? "Concentrated" : "Compounding"}</td>
              <td>{c.quoteToken.toLowerCase().startsWith("0x4200") ? `${fmt(c.threshold, 18)} WETH` : fmt(c.threshold, 18)}</td>
              <td>{BigInt(c.baseShortfall) > 0n ? fmt(c.baseShortfall, c.tokenDecimals) : "—"}</td>
              <td>{launchesBy.get(c.id) ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </>
  );
};
