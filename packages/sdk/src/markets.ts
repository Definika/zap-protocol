// Launch markets and risk tiers from `config/markets.json`: display metadata for the app and the on-chain listing
// parameters for the setup scripts.

import config from '../../../config/markets.json';

export type TierName = keyof typeof config.tiers;
export type Tier = (typeof config.tiers)[TierName];

export interface MarketInfo {
  index: number;
  symbol: string;
  base: string;
  name: string;
  category: string;
  color: string;
  logo: string;
  priceDecimals: number;
  sizeDecimals: number;
  pythProFeedId: number;
  tier: TierName;
  maxLeverage: number;
}

export const TIERS = config.tiers;

export const MARKETS: MarketInfo[] = config.markets.map((m, index) => ({
  ...m,
  index,
  tier: m.tier as TierName,
  logo: `/logos/${m.base.toLowerCase()}.png`,
  maxLeverage: config.tiers[m.tier as TierName].maxLeverage,
}));

export const marketBySymbol = (symbol: string) => MARKETS.find((m) => m.symbol === symbol);

/** On-chain `MarketParams` for a tier, as instruction arguments (USD amounts to 6 decimals). */
export function tierParams(tier: TierName): Record<string, unknown> {
  const t = config.tiers[tier];
  const usd = (x: number) => BigInt(x) * 1_000_000n;
  return {
    maxLeverage: t.maxLeverage,
    mmrBps: t.mmrBps,
    openFeeBps: t.openFeeBps,
    closeFeeBps: t.closeFeeBps,
    confMultBps: t.confMultBps,
    maxConfBps: t.maxConfBps,
    impactCapBps: t.impactCapBps,
    oiCapLongBps: t.oiCapLongBps,
    oiCapShortBps: t.oiCapShortBps,
    pad: [0, 0, 0, 0, 0, 0],
    minSpreadFrac: BigInt(t.minSpreadFrac),
    impactDepthUsd: usd(t.impactDepthUsd),
    maxPositionUsd: usd(t.maxPositionUsd),
  };
}
