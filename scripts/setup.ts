// Idempotent protocol setup for a cluster: test-USDC mint, config, the launch markets, the address lookup table and a
// seeded vault. Safe to re-run; each step skips what already exists.
//
//   CLUSTER=localnet node --import tsx scripts/setup.ts        (solana-test-validator on :8899)
//   CLUSTER=devnet RPC_URL=… node --import tsx scripts/setup.ts
//
// Env: USE_PYTH_STORAGE=1 trusts Pyth Pro's devnet signers (needs a Pyth key for the engine); otherwise only the dev
// signer is trusted. SEED_VAULT_USD sets the initial vault size (default 5,000,000).

import {
  AddressLookupTableProgram,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  type AddressLookupTableAccount,
} from '@solana/web3.js';
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from '@solana/spl-token';
import {
  INSTRUCTIONS_SYSVAR_ID,
  MARKETS,
  PROGRAM_ID,
  PYTH_PRO_STORAGE_DEVNET,
  TOKEN_PROGRAM_ID,
  accountPda,
  addMarket,
  assemble,
  configPda,
  createAccount,
  custodyPda,
  decodePool,
  deposit,
  initialize,
  lpDeposit,
  marketPda,
  poolPda,
  tierParams,
} from '../packages/sdk/src/index.ts';
import {
  CLUSTER,
  RPC_URL,
  connection,
  devPriceMessage,
  exists,
  loadKeypair,
  readDeployment,
  sendTx,
  usd,
  writeDeployment,
  type Deployment,
} from './lib.ts';

// Reference prices for the dev signer's seed message (only used while no market has open interest).
const SEED_PRICES: Record<string, number> = {
  BTC: 97_412.6, ETH: 3_486.21, XRP: 1.3612, BNB: 612.4, SOL: 184.126, DOGE: 0.09412, HYPE: 39.812, LINK: 9.078,
  AVAX: 9.341, SUI: 0.9447, JUP: 0.84213, PENGU: 0.008214, PUMP: 0.0024531, PYTH: 0.31872, JTO: 0.6102,
};

const admin = loadKeypair('admin');
const relayer = loadKeypair('relayer');
const keeper = loadKeypair('keeper');
const faucet = loadKeypair('faucet');
const oracle = loadKeypair('oracle-dev');
const usePythStorage = process.env.USE_PYTH_STORAGE === '1';
const seedUsd = Number(process.env.SEED_VAULT_USD ?? 5_000_000);

async function fund(who: PublicKey, sol: number) {
  if (CLUSTER !== 'localnet') return;
  if ((await connection.getBalance(who)) < sol * LAMPORTS_PER_SOL) {
    await connection.confirmTransaction(await connection.requestAirdrop(who, sol * LAMPORTS_PER_SOL), 'confirmed');
  }
}

async function main() {
  console.log(`setup on ${CLUSTER} (${RPC_URL}), program ${PROGRAM_ID.toBase58()}`);
  if (!(await exists(PROGRAM_ID))) throw new Error('program not deployed on this cluster');
  for (const k of [admin, relayer, keeper, faucet]) await fund(k.publicKey, 100);

  const prev = readDeployment();
  let mint = prev?.usdcMint ? new PublicKey(prev.usdcMint) : null;
  if (!mint || !(await exists(mint))) {
    mint = await createMint(connection, admin, faucet.publicKey, null, 6);
    console.log('created test USDC mint', mint.toBase58());
  }
  const deployment: Deployment = {
    cluster: CLUSTER,
    programId: PROGRAM_ID.toBase58(),
    usdcMint: mint.toBase58(),
    lookupTable: prev?.lookupTable,
    admin: admin.publicKey.toBase58(),
    relayer: relayer.publicKey.toBase58(),
    keeper: keeper.publicKey.toBase58(),
    faucet: faucet.publicKey.toBase58(),
    oracleSigner: oracle.publicKey.toBase58(),
    pythStorage: PYTH_PRO_STORAGE_DEVNET.toBase58(),
    usePythStorage,
  };
  writeDeployment(deployment);

  if (!(await exists(configPda()))) {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const params = {
      pythStorage: PYTH_PRO_STORAGE_DEVNET,
      oracleSigners: [oracle.publicKey, PublicKey.default],
      oracleSignerExpiry: [now + 90n * 86_400n, 0n],
      usePythStorage,
      requiredChannel: 3,
      maxPriceAgeS: 5,
      maxFutureS: 5,
      maxFeedAgeS: 10,
      priceGraceMs: 1_000,
      minOrderUsd: usd(10),
      maxUtilBps: 8_000,
      liqFeeBps: 20,
      liquidatorShareBps: 5_000,
      protocolFeeShareBps: 0,
      borrowKinkUtilBps: 7_500,
      borrowKinkAprBps: 3_000,
      borrowMaxAprBps: 10_000,
      fundingMaxHourly: 100_000_000_000_000n,
      sessionMaxSecs: 30 * 86_400,
      lpFeeBps: 0,
      lpCooldownS: 0,
      paused: false,
      lpPaused: false,
    };
    await sendTx([initialize(admin.publicKey, mint, params)], admin);
    console.log('initialized config');
  }

  // Markets, three per transaction.
  const missing = [];
  for (const m of MARKETS) if (!(await exists(marketPda(m.index)))) missing.push(m);
  for (let i = 0; i < missing.length; i += 3) {
    const batch = missing.slice(i, i + 3);
    await sendTx(batch.map((m) => addMarket(admin.publicKey, m.index, m.pythProFeedId, -8, m.symbol, tierParams(m.tier))), admin);
    console.log('listed', batch.map((m) => m.symbol).join(', '));
  }

  // Address lookup table with every static account a trade touches.
  let lut: AddressLookupTableAccount | null = null;
  if (deployment.lookupTable) lut = (await connection.getAddressLookupTable(new PublicKey(deployment.lookupTable))).value;
  if (!lut) {
    const slot = await connection.getSlot('finalized');
    const [create, address] = AddressLookupTableProgram.createLookupTable({ authority: admin.publicKey, payer: admin.publicKey, recentSlot: slot });
    const addresses = [
      configPda(), poolPda(), custodyPda(), mint, PYTH_PRO_STORAGE_DEVNET, INSTRUCTIONS_SYSVAR_ID, TOKEN_PROGRAM_ID,
      SystemProgram.programId, ...MARKETS.map((m) => marketPda(m.index)),
    ];
    await sendTx([create, AddressLookupTableProgram.extendLookupTable({ lookupTable: address, authority: admin.publicKey, payer: admin.publicKey, addresses })], admin);
    deployment.lookupTable = address.toBase58();
    writeDeployment(deployment);
    console.log('created lookup table', address.toBase58(), `(${addresses.length} addresses)`);
    // a new table is usable from the next slot
    const created = await connection.getSlot('confirmed');
    while ((await connection.getSlot('confirmed')) <= created) await new Promise((r) => setTimeout(r, 400));
    lut = (await connection.getAddressLookupTable(address)).value;
  }

  // Seed the vault from the admin's trading account.
  const pool = decodePool((await connection.getAccountInfo(poolPda()))!.data);
  if (pool.lpSupply === 0n && seedUsd > 0) {
    const ata = await getOrCreateAssociatedTokenAccount(connection, admin, mint, admin.publicKey);
    await mintTo(connection, admin, mint, ata.address, faucet, usd(seedUsd));
    const ixs = [];
    if (!(await exists(accountPda(admin.publicKey)))) ixs.push(createAccount(admin.publicKey, admin.publicKey, PublicKey.default, 0n));
    ixs.push(deposit(admin.publicKey, ata.address, mint, usd(seedUsd)));
    await sendTx(ixs, admin);
    const msg = await devPriceMessage(oracle, MARKETS.map((m) => ({ feedId: m.pythProFeedId, usd: SEED_PRICES[m.base] ?? 1 })));
    await sendTx(
      assemble([lpDeposit(admin.publicKey, admin.publicKey, MARKETS.length, msg, usd(seedUsd), PYTH_PRO_STORAGE_DEVNET)], { computeUnitLimit: 400_000 }),
      admin,
      [],
      lut ? [lut] : [],
    );
    console.log(`seeded vault with ${seedUsd.toLocaleString()} test USDC`);
  }
  console.log('done:', JSON.stringify(readDeployment(), null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
