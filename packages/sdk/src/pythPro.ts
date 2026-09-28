// Pyth Pro (formerly Lazer) signed price messages in the Solana format, mirroring the program's parser
// (`programs/zap/src/oracle/pyth_pro.rs`), plus the ed25519 verification instruction that must precede every
// price-carrying ZAP instruction, and a builder for messages signed by our own dev signer.

import { TransactionInstruction } from '@solana/web3.js';
import { ED25519_PROGRAM_ID, PRICE_MESSAGE_OFFSET, PythChannel } from './constants';

export const SOLANA_FORMAT_MAGIC = 2_182_742_457;
export const PAYLOAD_FORMAT_MAGIC = 2_479_346_549;
export const ENVELOPE_HEADER_LEN = 4 + 64 + 32 + 2;

export const Property = {
  Price: 0,
  BestBidPrice: 1,
  BestAskPrice: 2,
  PublisherCount: 3,
  Exponent: 4,
  Confidence: 5,
  FundingRate: 6,
  FundingTimestamp: 7,
  FundingRateInterval: 8,
  MarketSession: 9,
  EmaPrice: 10,
  EmaConfidence: 11,
  FeedUpdateTimestamp: 12,
} as const;

export interface PriceFeed {
  feedId: number;
  /** Mantissa in the feed exponent; 0n means "no price". */
  price: bigint;
  bestBid: bigint;
  bestAsk: bigint;
  confidence: bigint;
  exponent?: number;
  publisherCount?: number;
  feedUpdateTsUs?: bigint;
}

export interface PriceMessage {
  signature: Uint8Array;
  signer: Uint8Array;
  payload: Uint8Array;
  timestampUs: bigint;
  channel: number;
  feeds: PriceFeed[];
}

class Reader {
  private i = 0;
  private readonly v: DataView;
  constructor(private readonly b: Uint8Array) {
    this.v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  }
  private need(n: number) {
    if (this.i + n > this.b.length) throw new Error('price message: truncated');
    const at = this.i;
    this.i += n;
    return at;
  }
  u8 = () => this.v.getUint8(this.need(1));
  u16 = () => this.v.getUint16(this.need(2), true);
  i16 = () => this.v.getInt16(this.need(2), true);
  u32 = () => this.v.getUint32(this.need(4), true);
  u64 = () => this.v.getBigUint64(this.need(8), true);
  i64 = () => this.v.getBigInt64(this.need(8), true);
  optU64 = () => (this.u8() !== 0 ? this.u64() : undefined);
  get done() {
    return this.i === this.b.length;
  }
}

/** Parses a Solana-format signed message. Rejects unknown properties and trailing bytes, like the program. */
export function parsePriceMessage(msg: Uint8Array): PriceMessage {
  if (msg.length < ENVELOPE_HEADER_LEN) throw new Error('price message: too short');
  const view = new DataView(msg.buffer, msg.byteOffset, msg.byteLength);
  if (view.getUint32(0, true) !== SOLANA_FORMAT_MAGIC) throw new Error('price message: bad magic');
  const len = view.getUint16(100, true);
  if (msg.length !== ENVELOPE_HEADER_LEN + len) throw new Error('price message: length mismatch');
  const payload = msg.subarray(ENVELOPE_HEADER_LEN);
  const r = new Reader(payload);
  if (r.u32() !== PAYLOAD_FORMAT_MAGIC) throw new Error('price payload: bad magic');
  const timestampUs = r.u64();
  const channel = r.u8();
  const n = r.u8();
  const feeds: PriceFeed[] = [];
  for (let f = 0; f < n; f++) {
    const feed: PriceFeed = { feedId: r.u32(), price: 0n, bestBid: 0n, bestAsk: 0n, confidence: 0n };
    const props = r.u8();
    for (let p = 0; p < props; p++) {
      const id = r.u8();
      switch (id) {
        case Property.Price:
          feed.price = r.i64();
          break;
        case Property.BestBidPrice:
          feed.bestBid = r.i64();
          break;
        case Property.BestAskPrice:
          feed.bestAsk = r.i64();
          break;
        case Property.PublisherCount:
          feed.publisherCount = r.u16();
          break;
        case Property.Exponent:
          feed.exponent = r.i16();
          break;
        case Property.Confidence:
          feed.confidence = r.i64();
          break;
        case Property.FundingRate:
          if (r.u8() !== 0) r.i64();
          break;
        case Property.FundingTimestamp:
        case Property.FundingRateInterval:
          r.optU64();
          break;
        case Property.MarketSession:
          r.i16();
          break;
        case Property.EmaPrice:
        case Property.EmaConfidence:
          r.i64();
          break;
        case Property.FeedUpdateTimestamp:
          feed.feedUpdateTsUs = r.optU64();
          break;
        default:
          throw new Error(`price payload: unknown property ${id}`);
      }
    }
    feeds.push(feed);
  }
  if (!r.done) throw new Error('price payload: trailing bytes');
  return { signature: msg.subarray(4, 68), signer: msg.subarray(68, 100), payload, timestampUs, channel, feeds };
}

/**
 * ed25519 precompile instruction verifying `msg`, which sits at `PRICE_MESSAGE_OFFSET` in the data of the instruction
 * at `ixIndex` (the ZAP instruction this one precedes).
 */
export function ed25519Instruction(msg: Uint8Array, ixIndex: number): TransactionInstruction {
  const payloadLen = new DataView(msg.buffer, msg.byteOffset, msg.byteLength).getUint16(100, true);
  const sig = PRICE_MESSAGE_OFFSET + 4;
  const data = new Uint8Array(16);
  const v = new DataView(data.buffer);
  data[0] = 1;
  [sig, ixIndex, sig + 64, ixIndex, sig + 64 + 32 + 2, payloadLen, ixIndex].forEach((x, i) => v.setUint16(2 + i * 2, x, true));
  return new TransactionInstruction({ programId: ED25519_PROGRAM_ID, keys: [], data: Buffer.from(data) });
}

export interface FeedInput {
  feedId: number;
  /** Mantissa in `exponent`. */
  price: bigint;
  exponent: number;
  confidence?: bigint;
  feedUpdateTsUs: bigint;
}

/**
 * Payload with price, exponent, feed-update timestamp and (unless `withConfidence` is false) confidence per feed — the
 * properties ZAP reads. Multi-feed messages (LP, refresh) leave confidence out to fit in one transaction.
 */
export function buildPayload(
  timestampUs: bigint,
  feeds: FeedInput[],
  channel: number = PythChannel.FixedRate200,
  withConfidence = true,
): Uint8Array {
  const size = 4 + 8 + 1 + 1 + feeds.length * (4 + 1 + 9 + 3 + 9 + 10);
  const out = new Uint8Array(size);
  const v = new DataView(out.buffer);
  let i = 0;
  const u8 = (x: number) => void (out[i++] = x);
  const u32 = (x: number) => void (v.setUint32(i, x, true), (i += 4));
  const u64 = (x: bigint) => void (v.setBigUint64(i, x, true), (i += 8));
  const i64 = (x: bigint) => void (v.setBigInt64(i, x, true), (i += 8));
  u32(PAYLOAD_FORMAT_MAGIC);
  u64(timestampUs);
  u8(channel);
  u8(feeds.length);
  for (const f of feeds) {
    u32(f.feedId);
    u8(withConfidence ? 4 : 3);
    u8(Property.Price);
    i64(f.price);
    u8(Property.Exponent);
    v.setInt16(i, f.exponent, true);
    i += 2;
    if (withConfidence) {
      u8(Property.Confidence);
      i64(f.confidence ?? 0n);
    }
    u8(Property.FeedUpdateTimestamp);
    u8(1);
    u64(f.feedUpdateTsUs);
  }
  return out.subarray(0, i);
}

/** Wraps a payload in the Solana envelope, signed by `sign` (ed25519 over the payload). */
export async function signPayload(
  payload: Uint8Array,
  publicKey: Uint8Array,
  sign: (payload: Uint8Array) => Uint8Array | Promise<Uint8Array>,
): Promise<Uint8Array> {
  const signature = await sign(payload);
  if (signature.length !== 64 || publicKey.length !== 32) throw new Error('ed25519 signature/key size');
  const out = new Uint8Array(ENVELOPE_HEADER_LEN + payload.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, SOLANA_FORMAT_MAGIC, true);
  out.set(signature, 4);
  out.set(publicKey, 68);
  v.setUint16(100, payload.length, true);
  out.set(payload, ENVELOPE_HEADER_LEN);
  return out;
}
