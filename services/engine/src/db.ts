// Postgres (Neon) in production, embedded PGlite locally and in tests. Plain SQL through one small interface.
// Integers that can exceed 2^53 (USD with 6 decimals, 12-decimal prices) are stored as bigint/numeric and read back
// as strings; callers convert with BigInt().

import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { config } from './config';
import { logger } from './log';

const log = logger('db');

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

const SCHEMA = `
create table if not exists events (
  sig text not null, ix int not null, slot bigint not null, ts bigint not null, name text not null, data jsonb not null,
  primary key (sig, ix)
);
create index if not exists events_name_ts on events (name, ts desc);

create table if not exists fills (
  sig text not null, ix int not null, pool_seq bigint not null, ts bigint not null,
  account text not null, owner text not null, market int not null, side int not null, kind int not null,
  position_id bigint not null, order_id bigint not null, size_delta bigint not null, size_after bigint not null,
  collateral_after bigint not null, oracle_price numeric not null, fill_price numeric not null,
  open_fee bigint not null, close_fee bigint not null, spread_cost bigint not null, impact_cost bigint not null,
  borrow_paid bigint not null, funding_paid bigint not null, pnl bigint not null, payout bigint not null,
  primary key (sig, ix)
);
create index if not exists fills_owner_ts on fills (owner, ts desc);
create index if not exists fills_market_ts on fills (market, ts desc);

create table if not exists candles (
  market int not null, tf int not null, t bigint not null,
  o numeric not null, h numeric not null, l numeric not null, c numeric not null, v numeric not null default 0,
  primary key (market, tf, t)
);

create table if not exists vault_snapshots (
  ts bigint primary key, nav numeric not null, lp_supply numeric not null, assets numeric not null, reserved numeric not null
);

create table if not exists equity_snapshots (
  owner text not null, ts bigint not null, equity numeric not null, primary key (owner, ts)
);

create table if not exists faucet_claims (wallet text not null, user_id text not null, ts bigint not null);
create index if not exists faucet_wallet_ts on faucet_claims (wallet, ts desc);
create index if not exists faucet_user_ts on faucet_claims (user_id, ts desc);

create table if not exists alerts (
  id bigserial primary key, user_id text not null, market int not null, price numeric not null, direction text not null,
  created_at bigint not null, fired_at bigint
);
create table if not exists push_subscriptions (user_id text not null, endpoint text primary key, keys jsonb not null);

create table if not exists relay_log (sig text primary key, user_id text not null, ts bigint not null, lamports bigint not null);
create table if not exists cursor (id text primary key, value text not null);
`;

export async function openDb(): Promise<Db> {
  if (config.databaseUrl) {
    const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 5 });
    await pool.query(SCHEMA);
    log.info('connected to postgres');
    return {
      query: async <T>(sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows as T[],
      close: () => pool.end(),
    };
  }
  mkdirSync(config.dataDir, { recursive: true });
  const lite = new PGlite(config.dataDir);
  await lite.exec(SCHEMA);
  log.info(`using embedded PGlite at ${config.dataDir}`);
  return {
    query: async <T>(sql: string, params: unknown[] = []) => (await lite.query<T>(sql, params)).rows,
    close: () => lite.close(),
  };
}
