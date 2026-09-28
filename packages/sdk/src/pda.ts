import { PublicKey } from '@solana/web3.js';
import { PROGRAM_ID, SEEDS } from './constants';

const enc = new TextEncoder();
const find = (seeds: Uint8Array[], programId = PROGRAM_ID) => PublicKey.findProgramAddressSync(seeds, programId)[0];

export const configPda = (programId = PROGRAM_ID) => find([enc.encode(SEEDS.config)], programId);
export const poolPda = (programId = PROGRAM_ID) => find([enc.encode(SEEDS.pool)], programId);
export const custodyPda = (programId = PROGRAM_ID) => find([enc.encode(SEEDS.custody)], programId);

export function marketPda(index: number, programId = PROGRAM_ID): PublicKey {
  const le = new Uint8Array(2);
  new DataView(le.buffer).setUint16(0, index, true);
  return find([enc.encode(SEEDS.market), le], programId);
}

export const accountPda = (owner: PublicKey, programId = PROGRAM_ID) =>
  find([enc.encode(SEEDS.account), owner.toBytes()], programId);
