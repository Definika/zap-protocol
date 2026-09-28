// Node globals that @solana/web3.js and the Anchor coder expect in the browser.
import { Buffer } from 'buffer';

const g = globalThis as unknown as { Buffer?: typeof Buffer };
g.Buffer ??= Buffer;
