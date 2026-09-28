// Privy sessions: verifies the bearer access token on user endpoints (faucet, relay) and resolves the user's linked
// Solana wallets, so limits apply per person rather than per address. Off when PRIVY_APP_ID is unset (local development).

import { createRemoteJWKSet, jwtVerify } from 'jose';
import { logger } from './log';

const log = logger('auth');
const USER_TTL_MS = 60_000;

export interface AuthUser {
  /** Privy DID. */
  id: string;
  /** Linked Solana wallet addresses (embedded and external). */
  wallets: Set<string>;
}

export class AuthError extends Error {}

export class Auth {
  readonly enabled: boolean;
  private readonly jwks: ReturnType<typeof createRemoteJWKSet> | null;
  private readonly users = new Map<string, { user: AuthUser; at: number }>();

  constructor(
    private readonly appId: string,
    private readonly appSecret: string,
  ) {
    this.enabled = !!appId;
    this.jwks = appId ? createRemoteJWKSet(new URL(`https://auth.privy.io/api/v1/apps/${appId}/jwks.json`)) : null;
    if (this.enabled && !appSecret) log.warn('PRIVY_APP_SECRET is unset: linked wallets cannot be resolved');
  }

  /** The user behind an `Authorization: Bearer <token>` header; throws AuthError when missing or invalid. */
  async user(header: string | undefined): Promise<AuthUser> {
    const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token || !this.jwks) throw new AuthError('log in first');
    let id: string;
    try {
      const { payload } = await jwtVerify(token, this.jwks, { issuer: 'privy.io', audience: this.appId });
      id = String(payload.sub ?? '');
    } catch {
      throw new AuthError('session expired; log in again');
    }
    if (!id) throw new AuthError('invalid session');
    const hit = this.users.get(id);
    if (hit && Date.now() - hit.at < USER_TTL_MS) return hit.user;
    const user = { id, wallets: await this.wallets(id) };
    this.users.set(id, { user, at: Date.now() });
    return user;
  }

  /** Forgets a cached user (after they link a new wallet, for example). */
  forget(id: string) {
    this.users.delete(id);
  }

  private async wallets(id: string): Promise<Set<string>> {
    const r = await fetch(`https://auth.privy.io/api/v1/users/${encodeURIComponent(id)}`, {
      headers: {
        authorization: `Basic ${Buffer.from(`${this.appId}:${this.appSecret}`).toString('base64')}`,
        'privy-app-id': this.appId,
      },
      signal: AbortSignal.timeout(5_000),
    });
    if (!r.ok) throw new AuthError(`could not load the user (${r.status})`);
    const u = (await r.json()) as { linked_accounts?: { type: string; chain_type?: string; address?: string }[] };
    return new Set((u.linked_accounts ?? []).filter((a) => a.type === 'wallet' && a.chain_type === 'solana' && a.address).map((a) => a.address!));
  }
}
