import { BorshCoder, EventParser } from '@anchor-lang/core';
import { PublicKey } from '@solana/web3.js';
import { idl } from './accounts';
import { PROGRAM_ID } from './constants';

export interface ZapEvent {
  name: string;
  /** Integer fields as bigint, keys camelCase. */
  data: Record<string, unknown>;
}

const parser = new EventParser(PROGRAM_ID, new BorshCoder(idl));

/** BN → bigint, recursively; PublicKey and byte arrays pass through. */
function normalize(v: unknown): unknown {
  if (v === null || typeof v !== 'object' || v instanceof PublicKey) return v;
  if (Array.isArray(v)) return v.map(normalize);
  const maybeBn = v as { toTwos?: unknown; toString(): string };
  if (typeof maybeBn.toTwos === 'function') return BigInt(maybeBn.toString());
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normalize(x)]));
}

/** Decodes ZAP events from a transaction's log messages. */
export function parseEvents(logs: string[]): ZapEvent[] {
  return [...parser.parseLogs(logs)].map((e) => ({ name: e.name, data: normalize(e.data) as Record<string, unknown> }));
}
