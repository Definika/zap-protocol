// Vault NAV and LP share accounting. Port of `crates/zap-math/src/vault.rs`.
//
// NAV = realized assets + fees traders owe (borrow, funding) − traders' unrealized PnL, all computed in O(1) per market from
// per-side aggregates (`oi`, `units`, `Σ size·indexEntry`). The per-position profit cap and underwater positions are
// ignored here: the first makes NAV conservative, the second is covered by liquidations.

import { RATE_ONE, VIRTUAL_ASSETS, VIRTUAL_SHARES } from './constants';
import { arg, badVariant, checked } from './errors';
import { mulDiv, mulDivSigned, toI128 } from './fixed';
import type { Side } from './position';
import { valueOf } from './price';

/**
 * Traders' aggregate unrealized PnL on one side of a market (a liability of the vault), rounded against the vault: long
 * units are valued up, short units down.
 */
export function sideUpnl(side: Side, oiUsd: bigint, units: bigint, price12: bigint): bigint {
  arg(oiUsd, 'u64', 'oiUsd');
  arg(units, 'u128', 'units');
  arg(price12, 'u64', 'price12');
  switch (side) {
    case 'Long':
      return toI128(valueOf(units, price12, 'Up')) - oiUsd;
    case 'Short':
      return oiUsd - toI128(valueOf(units, price12, 'Down'));
    default:
      throw badVariant('side', side);
  }
}

/**
 * Fees owed to the vault across all positions on an index: `(index · Σsize − Σ size·indexEntry) / 1e18`, rounded down
 * (against the vault). `sumSizeXEntry` is stored unscaled (`sizeUsd · index`).
 */
export function aggregateOwed(indexNow: bigint, totalSize: bigint, sumSizeXEntry: bigint): bigint {
  arg(indexNow, 'i128', 'indexNow');
  arg(totalSize, 'u64', 'totalSize');
  arg(sumSizeXEntry, 'i128', 'sumSizeXEntry');
  const gross = checked(checked(indexNow * totalSize, 'i128') - sumSizeXEntry, 'i128');
  return mulDivSigned(gross, 1n, RATE_ONE, 'Down');
}

/**
 * LP shares minted for depositing `amount` into a vault with `supply` shares and `nav`, rounded down. Adding the virtual
 * amounts is plain u128 arithmetic in Rust, so a `supply` or `nav` within 1e6 of `u128::MAX` is an `Overflow`.
 */
export function sharesForDeposit(amount: bigint, supply: bigint, nav: bigint): bigint {
  arg(amount, 'u64', 'amount');
  arg(supply, 'u128', 'supply');
  arg(nav, 'u128', 'nav');
  return mulDiv(amount, checked(supply + VIRTUAL_SHARES, 'u128'), checked(nav + VIRTUAL_ASSETS, 'u128'), 'Down');
}

/** USD paid out for burning `shares`, rounded down. */
export function assetsForShares(shares: bigint, supply: bigint, nav: bigint): bigint {
  arg(shares, 'u128', 'shares');
  arg(supply, 'u128', 'supply');
  arg(nav, 'u128', 'nav');
  return mulDiv(shares, checked(nav + VIRTUAL_ASSETS, 'u128'), checked(supply + VIRTUAL_SHARES, 'u128'), 'Down');
}
