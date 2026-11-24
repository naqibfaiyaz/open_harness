import type { HermesConfig, HermesSecrets } from './config';
import { HERMES_PREFIX } from './sessions';

/** Private cookie jar for the stock Hermes password provider, including refresh rotation. */
export class HermesDashboard {
  private cookies = new Map<string, string>();
  private login?: Promise<void>;
  constructor(
    private config: HermesConfig,
    private secrets: HermesSecrets,
    private request: typeof fetch = fetch,
  ) {}

  private headers(input?: HeadersInit): Headers {
    const headers = new Headers(input);
    headers.set('X-Forwarded-Prefix', HERMES_PREFIX);
    headers.set('X-Forwarded-Proto', new URL(this.config.publicOrigin).protocol.slice(0, -1));
    headers.set('X-Forwarded-Host', new URL(this.config.publicOrigin).host);
    return headers;
  }

  private capture(response: Response) {
    for (const value of response.headers.getSetCookie()) {
      const pair = value.split(';', 1)[0];
      const index = pair.indexOf('=');
      if (index <= 0) continue;
      const name = pair.slice(0, index);
      if (/max-age=0(?:;|$)/i.test(value)) this.cookies.delete(name);
      else this.cookies.set(name, pair.slice(index + 1));
    }
  }

  private async signIn() {
    const response = await this.request(new URL('/auth/password-login', this.config.dashboardURL), {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        provider: this.secrets.dashboardProvider,
        username: this.secrets.dashboardUsername,
        password: this.secrets.dashboardPassword,
      }),
    });
    if (!response.ok) throw new Error('HERMES_AUTH_UNAVAILABLE');
    this.capture(response);
    if (!this.cookies.size) throw new Error('HERMES_AUTH_UNAVAILABLE');
  }

  async cookie(): Promise<string> {
    if (!this.cookies.size) {
      this.login ??= this.signIn().finally(() => {
        this.login = undefined;
      });
      await this.login;
    }
    return [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; ');
  }

  async fetch(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Invalid dashboard path');
    const headers = this.headers(init.headers);
    headers.set('Cookie', await this.cookie());
    const response = await this.request(`${this.config.dashboardURL}${path}`, {
      ...init,
      headers,
      redirect: 'manual',
      signal: init.signal ?? AbortSignal.timeout(30_000),
    });
    this.capture(response);
    const location = response.headers.get('location') ?? '';
    const loginRedirect =
      response.status >= 300 &&
      response.status < 400 &&
      (location.startsWith('/login') || location.startsWith(`${HERMES_PREFIX}/login`));
    if ((response.status === 401 || loginRedirect) && retry) {
      await response.body?.cancel();
      this.cookies.clear();
      return this.fetch(path, init, false);
    }
    return response;
  }

  async json(path: string): Promise<Record<string, unknown>> {
    const response = await this.fetch(path);
    if (!response.ok) throw new Error('HERMES_UNAVAILABLE');
    return response.json() as Promise<Record<string, unknown>>;
  }
}
