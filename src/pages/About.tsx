export const About = () => (
  <article className="prose">
    <span className="eyebrow">How it works</span>
    <h1 style={{ marginTop: "1rem" }}>
      How Clearpad checks <span className="grad-text">graduation</span>
    </h1>
    <p>
      An Ammora V4 launch sells tokens on a bonding curve. When the curve raises its target, it becomes{" "}
      <em>ReadyToMigrate</em> and anyone can call <code>migrate()</code> to move the raised WETH and the remaining tokens
      into a graduated Ammora pool.
    </p>
    <p>
      On GIWA Sepolia, Config #6 showed that a sold-out curve can still fail that step. Its curve could sell all
      1,000,000,000 tokens, but the pool needed another 333,333,333. <code>migrate()</code> reverted with{" "}
      <code>MigrationNotReady</code> and the buyers' WETH stayed in the curve. Ammora quarantined that Config and asked
      launchpads to check readiness before asking creators to sign.
    </p>
    <h2>What is checked</h2>
    <p>
      Clearpad mirrors the verified <code>ALCSegmentedPoolV4.migrate()</code> source in integer math, with the same
      rounding:
    </p>
    <ol className="steps">
      <li>
        <strong>Target reachable.</strong> The whole curve can absorb at least the quote target.
      </li>
      <li>
        <strong>Token inventory.</strong> Tokens left after the curve sells out ≥ the pool's base deposit (derived from{" "}
        <code>postMigrationLiquidity</code> at the curve's final price) + locked vesting.
      </li>
      <li>
        <strong>Deposit pairing.</strong> A non-zero <code>migrationBaseThreshold</code> must equal that derived deposit.
      </li>
      <li>
        <strong>Quote budget.</strong> Raised quote after the migration fee ≥ the pool's quote side.
      </li>
    </ol>
    <p>
      The same function runs against the Config before creation and against a live curve's reserves on every token page.
      Once a curve is ReadyToMigrate, the page also runs <code>migrate()</code> as an <code>eth_call</code> and shows the
      real result.
    </p>
    <h2>Validated against the incident</h2>
    <p>
      For Config #6 the check reports a shortfall of exactly 333,333,333 tokens, matching Ammora's published
      investigation, and the KILN curve's live <code>migrate()</code> simulation reverts as predicted. Configs that did
      graduate on testnet, such as #10, pass.
    </p>
    <h2>Where it runs</h2>
    <ul>
      <li>
        <strong>Create:</strong> blocked Configs cannot be selected. Right before the wallet prompt, the Config is re-read
        at the current block and checked again, then the create call is simulated.
      </li>
      <li>
        <strong>Buy:</strong> buying into a launch that cannot graduate needs an explicit acknowledgement.
      </li>
      <li>
        <strong>Graduate:</strong> the button appears only when the live <code>migrate()</code> simulation succeeds.
      </li>
    </ul>
    <h2>Built with the Ammora SDK</h2>
    <p>
      <code>@ammora-protocol/sdk</code> 0.3.9: <code>getAmmoraV4ConfigAtBlock</code> for Config snapshots,{" "}
      <code>AmmoraV4LaunchCurveClient</code> for curve state, quotes, swap plans and migration plans,{" "}
      <code>classifyAmmoraV4ExactInputFill</code> for final fills, <code>buildCreateAmmoraV4Launch</code> and{" "}
      <code>parseAmmoraV4LaunchCreatedReceipt</code> for creation. The launch list is indexed from the factory's{" "}
      <code>LaunchCreated</code> events.
    </p>
    <p className="muted">
      Testnet software. The check covers the graduation conditions above. It is not an audit of the token, the creator or
      the Ammora contracts.
    </p>
  </article>
);
