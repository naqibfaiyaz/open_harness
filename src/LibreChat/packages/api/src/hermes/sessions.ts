import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const TTL = 90_000;
export const HERMES_COOKIE = 'lc_hermes_workspace';
export const HERMES_PREFIX = '/hermes-workspace';
interface Grant {
  token: string;
  userId: string;
  expires: number;
}

/** Opaque, short-lived browser grants. Never send the LibreChat bearer or Hermes credentials. */
export class WorkspaceSessions {
  private grants = new Map<string, Grant>();
  constructor(private now: () => number = Date.now) {}
  private hash(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  issue(token: string, userId: string, previous?: string): string {
    this.prune();
    const existing = this.get(previous);
    if (previous && existing?.userId === userId) {
      existing.token = token;
      existing.expires = this.now() + TTL;
      return previous;
    }
    if (this.grants.size >= 1000) throw new Error('Workspace session limit');
    if (previous) this.revoke(previous);
    const value = randomBytes(32).toString('base64url');
    this.grants.set(this.hash(value), { token, userId, expires: this.now() + TTL });
    return value;
  }

  get(value: string | undefined): Grant | undefined {
    if (!value || value.length > 128) return undefined;
    const key = this.hash(value);
    const grant = this.grants.get(key);
    if (grant && grant.expires > this.now()) return grant;
    this.grants.delete(key);
    return undefined;
  }

  revoke(value: string) {
    this.grants.delete(this.hash(value));
  }

  private prune() {
    for (const [key, grant] of this.grants)
      if (grant.expires <= this.now()) this.grants.delete(key);
  }
}

export function readWorkspaceCookie(header: string | undefined): string | undefined {
  const entry = header
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${HERMES_COOKIE}=`));
  return entry?.slice(HERMES_COOKIE.length + 1);
}

export function serviceKeyMatches(header: string | undefined, key: string): boolean {
  const candidate = Buffer.from(header ?? '');
  const expected = Buffer.from(`Bearer ${key}`);
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function sessionKey(key: string, user: string, conversation: string): string {
  // A stable opaque namespace; no email, user id or conversation text leaves LibreChat.
  return createHash('sha256')
    .update(JSON.stringify([key, user, conversation]))
    .digest('hex');
}
