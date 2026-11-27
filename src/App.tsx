import { useEffect, useState } from "react";
import type { IndexFile } from "./lib/indexTypes";
import { connectWallet, onAccountsChanged, restoreWallet, type Wallet } from "./lib/wallet";
import { shortError } from "./lib/launch";
import { short } from "./ui";
import { Wordmark } from "./Logo";
import { Feed } from "./pages/Feed";
import { TokenPage } from "./pages/TokenPage";
import { Create } from "./pages/Create";
import { Audit } from "./pages/Audit";
import { About } from "./pages/About";
import { Portfolio } from "./pages/Portfolio";
import { Swap } from "./pages/Swap";

const useHash = () => {
  const [hash, setHash] = useState(() => window.location.hash.slice(1) || "/");
  useEffect(() => {
    const on = () => {
      setHash(window.location.hash.slice(1) || "/");
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash;
};

export default function App() {
  const route = useHash();
  const [index, setIndex] = useState<IndexFile>();
  const [indexError, setIndexError] = useState<string>();
  const [wallet, setWallet] = useState<Wallet>();
  const [walletError, setWalletError] = useState<string>();

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}index.json`, { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`index.json ${r.status}`))))
      .then(setIndex)
      .catch((e) => setIndexError(String(e.message ?? e)));
  }, []);

  useEffect(() => {
    void restoreWallet().then((w) => w && setWallet(w), () => undefined);
    return onAccountsChanged(setWallet);
  }, []);

  const connect = async () => {
    setWalletError(undefined);
    try {
      setWallet(await connectWallet());
    } catch (e) {
      setWalletError(shortError(e));
    }
  };

  const [path, arg] = route.split("/").filter(Boolean);
  const nav = (to: string, label: string) => (
    <a href={`#${to}`} className={`/${path ?? ""}` === to ? "active" : ""}>
      {label}
    </a>
  );

  return (
    <>
      <header className="top">
        <a href="#/" className="brand" aria-label="Clearpad home">
          <Wordmark />
        </a>
        <nav>
          {nav("/", "Launches")}
          {nav("/swap", "Swap")}
          {nav("/create", "Create")}
          {nav("/portfolio", "Portfolio")}
          {nav("/audit", "Config audit")}
          {nav("/about", "How it works")}
        </nav>
        <div className="wallet">
          <span className="net" title="GIWA Sepolia testnet, chain 91342">
            <i /> GIWA Sepolia
          </span>
          {wallet ? (
            <a className="pill mono" href="#/portfolio" title="Your portfolio">
              <i /> {short(wallet.address)}
            </a>
          ) : (
            <button className="btn primary" onClick={connect}>
              Connect
            </button>
          )}
        </div>
      </header>
      {walletError && <div className="notice error wide">{walletError}</div>}
      <main>
        {path === "token" && arg ? (
          <TokenPage key={arg} curveOrToken={arg} wallet={wallet} onConnect={connect} index={index} />
        ) : path === "create" ? (
          <Create index={index} wallet={wallet} onConnect={connect} />
        ) : path === "audit" ? (
          <Audit index={index} />
        ) : path === "swap" ? (
          <Swap index={index} wallet={wallet} onConnect={connect} curve={arg} />
        ) : path === "portfolio" ? (
          <Portfolio key={arg ?? "me"} index={index} wallet={wallet} onConnect={connect} address={arg} />
        ) : path === "about" ? (
          <About />
        ) : (
          <Feed index={index} error={indexError} />
        )}
      </main>
      <footer>
        <div>
          <Wordmark />
        </div>
        Built with <a href="https://www.npmjs.com/package/@ammora-protocol/sdk">@ammora-protocol/sdk</a> on GIWA
        Sepolia testnet · Test assets only, not audited · <a href="https://github.com/bars26/clearpad">Source</a>
      </footer>
    </>
  );
}
