// ZAP engine: oracle stream, state mirror, relayer, faucet, indexer, keeper and API in one service.
// Roles can be split across processes with ENGINE_ROLES.

import { Connection } from '@solana/web3.js';
import { config } from './config';
import { openDb } from './db';
import { OracleHub } from './oracle/hub';
import { startDevOracle, type DevOracle } from './oracle/dev';
import { Mirror } from './chain/mirror';
import { Sender } from './chain/send';
import { Relayer } from './relayer';
import { Faucet } from './faucet';
import { Candles } from './candles';
import { Indexer } from './indexer';
import { startApi } from './api';
import { Keeper } from './keeper';
import { logger } from './log';

const log = logger('main');

async function main() {
  const has = (r: string) => config.roles.has(r);
  log.info(`starting on ${config.cluster} with roles ${[...config.roles].join(',')}`);
  const connection = new Connection(config.rpcUrls[0]!, { commitment: 'confirmed', wsEndpoint: config.rpcWsUrl });
  const db = await openDb();

  const hub = new OracleHub(config.oracleMode);
  let devOracle: DevOracle | undefined;
  if (has('oracle')) {
    if (config.oracleMode === 'dev') devOracle = await startDevOracle(hub, config.keys.oracle());
    else throw new Error('ORACLE_MODE=pyth is not wired yet');
  }

  const mirror = new Mirror(connection);
  await mirror.start();
  const sender = new Sender(connection);
  await sender.init();

  const candles = new Candles(db);
  candles.attach(hub);
  const indexer = has('indexer') ? new Indexer(connection, db, candles) : undefined;
  await indexer?.start();

  const relayer = has('relayer') ? new Relayer(connection, sender, config.keys.relayer()) : undefined;
  const faucet = has('faucet') ? new Faucet(db, sender, config.keys.relayer(), config.keys.faucet()) : undefined;

  const keeper = has('keeper') ? new Keeper(mirror, hub, sender, config.keys.keeper()) : undefined;
  await keeper?.start();

  if (has('api')) await startApi({ db, hub, mirror, candles, indexer, relayer, faucet, devOracle });

  const shutdown = async () => {
    log.info('shutting down');
    keeper?.stop();
    await indexer?.stop();
    await mirror.stop();
    await db.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  log.error('fatal', e);
  process.exit(1);
});
