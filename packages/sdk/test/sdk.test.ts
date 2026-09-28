import { readFileSync } from 'node:fs';
import { Keypair } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import {
  ED25519_PROGRAM_ID,
  MARKETS,
  PRICE_MESSAGE_OFFSET,
  PROGRAM_ID,
  Side,
  addMarket,
  assemble,
  buildPayload,
  decodeStruct,
  idl,
  openPosition,
  parsePriceMessage,
  signPayload,
  tierParams,
} from '../src';
import layout from '../src/generated/layout.json';

const vectorHex = readFileSync(new URL('../../../programs/zap/tests/fixtures/pyth_pro_btc_vector.hex', import.meta.url), 'utf8').trim();
const vector = Uint8Array.from(vectorHex.match(/../g)!.map((h) => parseInt(h, 16)));

describe('pyth pro messages', () => {
  it('parses the real signed BTC vector like the program', () => {
    const m = parsePriceMessage(vector);
    expect(m.timestampUs).toBe(1_771_339_368_200_000n);
    expect(m.channel).toBe(3);
    expect(m.feeds).toHaveLength(1);
    expect(m.feeds[0]).toMatchObject({
      feedId: 1,
      price: 6_713_436_287_632n,
      bestBid: 6_713_017_907_790n,
      bestAsk: 6_713_596_631_740n,
      confidence: 1_500_580_860n,
      exponent: -8,
      publisherCount: 18,
      feedUpdateTsUs: 1_771_339_368_200_000n,
    });
  });

  it('rejects malformed messages', () => {
    expect(() => parsePriceMessage(vector.subarray(0, vector.length - 1))).toThrow();
    const bad = vector.slice();
    bad[0] = bad[0]! ^ 1;
    expect(() => parsePriceMessage(bad)).toThrow(/magic/);
  });

  it('builds and signs messages that parse back', async () => {
    const payload = buildPayload(1_000_000n, [{ feedId: 6, price: 18_412_600_000n, exponent: -8, confidence: 5n, feedUpdateTsUs: 999_000n }]);
    const kp = Keypair.generate();
    const msg = await signPayload(payload, kp.publicKey.toBytes(), () => new Uint8Array(64).fill(7));
    const m = parsePriceMessage(msg);
    expect(m.feeds[0]).toMatchObject({ feedId: 6, price: 18_412_600_000n, exponent: -8, confidence: 5n, feedUpdateTsUs: 999_000n });
    expect([...m.signer]).toEqual([...kp.publicKey.toBytes()]);
  });
});

describe('instructions', () => {
  it('encodes open_position with the price message at the fixed offset', () => {
    const kp = Keypair.generate();
    const { ix } = openPosition({ signer: kp.publicKey, owner: kp.publicKey, market: 0 }, vector, {
      side: Side.Long,
      size: 10_000_000_000n,
      collateral: 100_000_000n,
    });
    expect(ix.programId.equals(PROGRAM_ID)).toBe(true);
    expect(ix.keys).toHaveLength(7);
    expect(ix.keys[0]).toMatchObject({ isSigner: true, isWritable: false });
    const data = new Uint8Array(ix.data);
    // discriminator(8) | vec len(4) | message
    expect(new DataView(data.buffer, data.byteOffset).getUint32(8, true)).toBe(vector.length);
    expect([...data.subarray(PRICE_MESSAGE_OFFSET, PRICE_MESSAGE_OFFSET + vector.length)]).toEqual([...vector]);
    // then side(u8), size(u64), collateral(u64), acceptable(u64), tp(u64), sl(u64)
    expect(data.length).toBe(PRICE_MESSAGE_OFFSET + vector.length + 1 + 5 * 8);
  });

  it('assembles the ed25519 check right before each priced instruction', () => {
    const kp = Keypair.generate();
    const priced = openPosition({ signer: kp.publicKey, owner: kp.publicKey, market: 0 }, vector, {
      side: Side.Long,
      size: 1n,
      collateral: 1n,
    });
    const ixs = assemble([priced], { computeUnitLimit: 200_000 });
    expect(ixs).toHaveLength(3);
    const ed = ixs[1]!;
    expect(ed.programId.equals(ED25519_PROGRAM_ID)).toBe(true);
    const v = new DataView(new Uint8Array(ed.data).buffer);
    // one signature; every instruction index points at the ZAP instruction (index 2)
    expect(ed.data[0]).toBe(1);
    expect([v.getUint16(4, true), v.getUint16(8, true), v.getUint16(14, true)]).toEqual([2, 2, 2]);
    expect([v.getUint16(2, true), v.getUint16(6, true), v.getUint16(10, true)]).toEqual([16, 80, 114]);
  });

  it('builds add_market from the tier config', () => {
    const kp = Keypair.generate();
    const ix = addMarket(kp.publicKey, 0, 1, -8, 'BTC-USD', tierParams('A'));
    expect(ix.keys).toHaveLength(5);
    // discriminator + index u16 + feed u32 + expo i16 + symbol[16] + MarketParams(48)
    expect(ix.data.length).toBe(8 + 2 + 4 + 2 + 16 + 48);
  });
});

describe('layout', () => {
  it('matches the program struct sizes', () => {
    expect(layout.Pool.size).toBe(272);
    expect(layout.Market.size).toBe(400);
    expect(layout.TradingAccount.size).toBe(4584);
    const zero = decodeStruct('TradingAccount', new Uint8Array(layout.TradingAccount.size));
    expect((zero.positions as unknown[]).length).toBe(16);
    expect((zero.orders as unknown[]).length).toBe(24);
  });

  it('lists all launch markets with a known tier', () => {
    expect(MARKETS).toHaveLength(15);
    expect(MARKETS[0]).toMatchObject({ symbol: 'BTC-USD', pythProFeedId: 1, maxLeverage: 100, index: 0 });
    expect(idl.instructions.some((i) => i.name === 'openPosition')).toBe(true);
  });
});
