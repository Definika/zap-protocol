// Switches which signer the program trusts for prices: Pyth's on-chain storage account (production Pyth Pro), or
// ZAP's dev oracle key (local testing, and devnet until the Pyth Pro key is live). Run it together with the engine's
// ORACLE_MODE so the prices it serves are signed by the trusted party.
//
//   CLUSTER=devnet npx tsx scripts/set-oracle.ts pyth|dev

import { configPda, decodeConfig, updateConfig } from '../packages/sdk/src/index.ts';
import { CLUSTER, connection, loadKeypair, readDeployment, sendTx, writeDeployment } from './lib.ts';

const mode = process.argv[2];
if (mode !== 'pyth' && mode !== 'dev') {
  console.error('usage: set-oracle.ts pyth|dev');
  process.exit(1);
}
const admin = loadKeypair('admin');
const info = await connection.getAccountInfo(configPda());
if (!info) throw new Error(`no ZAP config on ${CLUSTER}: run setup first`);
const { params } = decodeConfig(info.data);
const usePythStorage = mode === 'pyth';
if (params.usePythStorage === usePythStorage) {
  console.log(`already trusting the ${mode} oracle`);
} else {
  await sendTx([updateConfig(admin.publicKey, { ...params, usePythStorage })], admin);
  console.log(`now trusting the ${mode} oracle (${usePythStorage ? `Pyth storage ${params.pythStorage.toBase58()}` : 'dev signer'})`);
}
const d = readDeployment();
if (d) writeDeployment({ ...d, usePythStorage });
