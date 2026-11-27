export type IndexedConfig = {
  id: number;
  configHash: string;
  owner: string;
  enabled: boolean;
  quarantined: boolean;
  verdict: "ready" | "blocked";
  failed: string[];
  baseShortfall: string;
  tokenDecimals: number;
  quoteToken: string;
  threshold: string;
  migrationMode: number;
  poolCreationFee: string;
};

export type IndexedLaunch = {
  token: string;
  curve: string;
  creator: string;
  configId: number;
  block: number;
  metadataURI: string;
  name: string;
  symbol: string;
  status: number;
  baseReserve: string;
  quoteReserve: string;
  threshold: string;
};

export type IndexFile = {
  chainId: number;
  factory: string;
  registry: string;
  generatedAt: string;
  scannedTo: number;
  configs: Record<string, IndexedConfig>;
  launches: IndexedLaunch[];
};
