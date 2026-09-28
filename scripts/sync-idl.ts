// Copies the program's IDL, generated TypeScript types and error codes into the SDK after `anchor build`,
// and regenerates the zero-copy account layout from the Rust structs.
//
//   node scripts/sync-idl.ts

import { copyFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'packages/sdk/src/idl');
mkdirSync(out, { recursive: true });
copyFileSync(resolve(root, 'target/idl/zap.json'), resolve(out, 'zap.json'));
copyFileSync(resolve(root, 'target/types/zap.ts'), resolve(out, 'zap.ts'));
copyFileSync(resolve(root, 'target/types/zap_errors.ts'), resolve(out, 'errors.ts'));
execFileSync('cargo', ['test', '-q', '-p', 'zap', '--test', 'layout', '--', '--ignored'], { cwd: root, stdio: 'inherit' });
console.log('synced IDL, types, errors and layout into packages/sdk/src');
