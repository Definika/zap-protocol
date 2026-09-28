// End-to-end smoke test against a running cluster (after scripts/setup.ts): a new user gets test USDC, creates a
// trading account with a session key (relayer pays rent), deposits, then trades gaslessly — the session key signs, the
// relayer pays the fee — opening and closing a long at dev-signer prices.
//
//   CLUSTER=localnet npx tsx scripts/smoke.ts

import { Keypair, PublicKey } from '@solana/web3.js';
import { getOrCreateAssociatedTokenAccount, mintTo } from '@solana/spl-token';
import {
  MARKETS,
  PYTH_PRO_STORAGE_DEVNET,
  Side,
  accountPda,
  assemble,
  closePosition,
  createAccount,
  decodePool,
  decodeTradingAccount,
  deposit,
  openPositions,
  openPosition,
  poolPda,
} from '../packages/sdk/src/index.ts';
import { connection, devPriceMessage, eventsOf, loadKeypair, readDeployment, sendTx, usd } from './lib.ts';

const d = readDeployment();
if (!d?.lookupTable) throw new Error('run scripts/setup.ts first');
const mint = new PublicKey(d.usdcMint);
const relayer = loadKeypair('relayer');
const faucet = loadKeypair('faucet');
const oracle = loadKeypair('oracle-dev');
const lut = (await connection.getAddressLookupTable(new PublicKey(d.lookupTable))).value!;
const sol = MARKETS.find((m) => m.base === 'SOL')!;

const user = Keypair.generate();
const session = Keypair.generate();
console.log('user', user.publicKey.toBase58(), 'session', session.publicKey.toBase58());

// Faucet: test USDC to the user's wallet (the relayer pays for the token account).
const ata = await getOrCreateAssociatedTokenAccount(connection, relayer, mint, user.publicKey);
await mintTo(connection, relayer, mint, ata.address, faucet, usd(10_000));

// One owner signature: create the trading account with a 7-day session key, and deposit. The relayer pays fee and rent.
const expires = BigInt(Math.floor(Date.now() / 1000) + 7 * 86_400);
await sendTx([createAccount(user.publicKey, relayer.publicKey, session.publicKey, expires), deposit(user.publicKey, ata.address, mint, usd(1_000))], relayer, [user], [lut]);
console.log('account created and 1,000 USDC deposited');

// Session key trades: open a $5,000 SOL long with $200 at 25x.
const trade = { signer: session.publicKey, owner: user.publicKey, market: sol.index, pythStorage: PYTH_PRO_STORAGE_DEVNET };
let msg = await devPriceMessage(oracle, [{ feedId: sol.pythProFeedId, usd: 184.126 }]);
const openIxs = assemble([openPosition(trade, msg, { side: Side.Long, size: usd(5_000), collateral: usd(200) })], { computeUnitLimit: 200_000 });
const openSig = await sendTx(openIxs, relayer, [session], [lut]);
const opened = (await eventsOf(openSig)).find((e) => e.name === 'trade')?.data;
console.log('opened long: fill', opened?.fillPrice, 'fee', opened?.openFee, 'sig', openSig.slice(0, 16) + '…');

let acct = decodeTradingAccount((await connection.getAccountInfo(accountPda(user.publicKey)))!.data);
const pos = openPositions(acct)[0]!;
console.log('position', { size: pos.sizeUsd, collateral: pos.collateral, units: pos.units });

// Price +1%, close everything.
msg = await devPriceMessage(oracle, [{ feedId: sol.pythProFeedId, usd: 185.967 }]);
const closeSig = await sendTx(assemble([closePosition(trade, msg, Side.Long, pos.positionId)], { computeUnitLimit: 200_000 }), relayer, [session], [lut]);
const closed = (await eventsOf(closeSig)).find((e) => e.name === 'trade')?.data;
acct = decodeTradingAccount((await connection.getAccountInfo(accountPda(user.publicKey)))!.data);
console.log('closed: pnl', closed?.pnl, 'payout', closed?.payout, 'balance now', acct.balance);
const pool = decodePool((await connection.getAccountInfo(poolPda()))!.data);
console.log('vault assets', pool.assets, 'reserved', pool.reserved, 'volume', pool.cumVolume);
if (openPositions(acct).length !== 0 || acct.balance <= usd(1_000)) throw new Error('unexpected end state');
console.log('smoke test passed');
