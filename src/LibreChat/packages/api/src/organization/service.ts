import type {
  OrganizationConfig,
  OrganizationRole,
  OrganizationMember,
} from 'librechat-data-provider';

export interface IdentityUser {
  id?: string;
  _id?: unknown;
  openidId?: string;
  openidIssuer?: string;
  email?: string;
  role?: string;
}
interface KeycloakUser {
  id: string;
  email?: string;
  enabled?: boolean;
}
interface Role {
  id: string;
  name: string;
}
export class IdentityError extends Error {
  constructor(
    public code: string,
    public status = 403,
  ) {
    super(code);
  }
}
export class OrganizationService {
  private token?: { value: string; until: number };
  constructor(
    public config: OrganizationConfig,
    private secret: string,
    private request: typeof fetch = fetch,
  ) {}

  async call<T>(path: string, method = 'GET', body?: object): Promise<T> {
    if (!this.token || this.token.until < Date.now()) {
      const response = await this.request(
        `${this.config.adminURL}/realms/${this.config.realm}/protocol/openid-connect/token`,
        {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(this.config.timeoutMs),
          body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: this.config.clientId,
            client_secret: this.secret,
          }),
        },
      );
      if (!response.ok) throw new IdentityError('ORG_UNAVAILABLE', 503);
      const token = (await response.json()) as { access_token: string; expires_in: number };
      this.token = {
        value: token.access_token,
        until: Date.now() + Math.max(0, token.expires_in - 30) * 1000,
      };
    }
    const response = await this.request(
      `${this.config.adminURL}/admin/realms/${this.config.realm}${path}`,
      {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(this.config.timeoutMs),
        headers: {
          Authorization: `Bearer ${this.token.value}`,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
    );
    if (!response.ok)
      throw new IdentityError(
        response.status === 409 ? 'ORG_CONFLICT' : 'ORG_UNAVAILABLE',
        response.status === 409 ? 409 : 503,
      );
    return response.status === 201 ||
      response.status === 204 ||
      response.headers.get('content-length') === '0'
      ? (undefined as T)
      : (response.json() as Promise<T>);
  }
  async roles(id: string): Promise<Role[]> {
    return this.call(`/users/${encodeURIComponent(id)}/role-mappings/realm`);
  }
  role(roles: Role[]): OrganizationRole | undefined {
    return (['owner', 'admin', 'user'] as const).find((role) =>
      roles.some((r) => r.name === `org-${role}`),
    );
  }
  async authorize(
    user?: IdentityUser,
  ): Promise<{ role: OrganizationRole; bootstrap: boolean; subject?: string }> {
    if (!user) throw new IdentityError('ORG_FORBIDDEN');
    // A configured recovery account is local-only; an IdP user can never claim this bypass.
    if (!user.openidId && this.config.bootstrapUserIds.includes(String(user.id ?? user._id))) {
      return { role: 'owner', bootstrap: true };
    }
    if (!user.openidId || user.openidIssuer !== this.config.issuer)
      throw new IdentityError('ORG_FORBIDDEN');
    const account = await this.call<KeycloakUser>(`/users/${encodeURIComponent(user.openidId)}`);
    if (!account.enabled) throw new IdentityError('ORG_FORBIDDEN');
    const role = this.role(await this.roles(account.id));
    if (!role) throw new IdentityError('ORG_FORBIDDEN');
    return { role, bootstrap: false, subject: account.id };
  }
  async members(): Promise<OrganizationMember[]> {
    const rows = await this.call<KeycloakUser[]>(`/users?max=${this.config.maxMembers + 1}`);
    if (rows.filter((user) => user.email).length > this.config.maxMembers) throw new IdentityError('ORG_MEMBER_LIMIT', 409);
    return Promise.all(
      rows
        .filter((u) => u.email)
        .map(async (u) => ({
          id: u.id,
          email: u.email!,
          enabled: u.enabled === true,
          role: this.role(await this.roles(u.id)) ?? 'pending',
        })),
    );
  }
  async assign(id: string, role: OrganizationRole): Promise<void> {
    const desired = await this.call<Role>(`/roles/org-${role}`);
    const path = `/users/${encodeURIComponent(id)}/role-mappings/realm`;
    await this.call(path, 'POST', [desired]);
    const old = (await this.roles(id)).filter(
      (r) => r.name.startsWith('org-') && r.name !== desired.name,
    );
    if (old.length) await this.call(path, 'DELETE', old);
  }
  async create(email: string, password: string, role: OrganizationRole, temporary = true): Promise<string> {
    if ((await this.members()).length >= this.config.maxMembers)
      throw new IdentityError('ORG_MEMBER_LIMIT', 409);
    await this.call('/users', 'POST', {
      username: email,
      email,
      enabled: true,
      emailVerified: false,
      credentials: [{ type: 'password', value: password, temporary }],
      requiredActions: temporary ? ['UPDATE_PASSWORD'] : [],
    });
    const users = await this.call<KeycloakUser[]>(
      `/users?username=${encodeURIComponent(email)}&exact=true`,
    );
    if (users.length !== 1) throw new IdentityError('ORG_UNAVAILABLE', 503);
    await this.assign(users[0].id, role);
    return users[0].id;
  }
}
