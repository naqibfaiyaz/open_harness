import { createHmac } from 'node:crypto';
import type { HermesConfig, HermesSecrets } from './config';
import type { HermesDashboard } from './dashboard';

interface Profile {
  name: string;
  description?: string;
}
interface Model {
  id: string;
  object: 'model';
  owned_by: string;
  created: number;
}
export const profileAlias = (name: string) => `Agent: ${name}`;
export const modelAlias = (name: string) => `Model: ${name}`;

/** Hermes alone owns the agent loop. This adapter selects the profile, never executes tools. */
export class HermesRuntime {
  constructor(
    private config: HermesConfig,
    private secrets: HermesSecrets,
    private dashboard: HermesDashboard,
    private request: typeof fetch = fetch,
  ) {}

  async profiles(): Promise<Profile[]> {
    const payload = await this.dashboard.json('/api/profiles');
    if (!Array.isArray(payload.profiles)) throw new Error('HERMES_PROFILE_CONTRACT');
    return payload.profiles.filter(
      (p: unknown): p is Profile =>
        typeof p === 'object' &&
        p !== null &&
        'name' in p &&
        typeof p.name === 'string' &&
        /^[a-z0-9][a-z0-9_-]{0,63}$/.test(p.name),
    );
  }

  private key(profile: string): string {
    return profile === 'default'
      ? this.secrets.runtimeKey
      : createHmac('sha256', this.secrets.bridgeKey)
          .update(`profile:${profile}`)
          .digest('base64url');
  }

  private path(profile: string): string {
    return profile === 'default' ? '/v1' : `/p/${encodeURIComponent(profile)}/v1`;
  }

  private async models(profile: string): Promise<Model[]> {
    const response = await this.request(`${this.config.runtimeURL}${this.path(profile)}/models`, {
      headers: { Authorization: `Bearer ${this.key(profile)}` },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('HERMES_PROFILE_NOT_READY');
    const payload = (await response.json()) as { data?: Model[] };
    if (
      !Array.isArray(payload.data) ||
      !payload.data.length ||
      !payload.data.every((model) => model && typeof model.id === 'string' && model.id.length > 0)
    )
      throw new Error('HERMES_MODEL_CONTRACT');
    return payload.data;
  }

  async catalog(): Promise<{ object: 'list'; data: Model[] }> {
    const [profiles, defaults] = await Promise.all([this.profiles(), this.models('default')]);
    const makeModel = (id: string): Model => ({
      id,
      object: 'model',
      owned_by: 'hermes',
      created: 0,
    });
    return {
      object: 'list',
      data: [
        ...profiles.map((p) => makeModel(profileAlias(p.name))),
        ...defaults.map((m) => makeModel(modelAlias(m.id))),
      ],
    };
  }

  async publish(profile: string): Promise<{ profile: string; ready: boolean }> {
    if (!(await this.profiles()).some((p) => p.name === profile))
      throw new Error('HERMES_UNKNOWN_PROFILE');
    if (profile !== 'default') {
      const response = await this.dashboard.fetch('/api/env', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'API_SERVER_KEY', value: this.key(profile), profile }),
      });
      if (!response.ok) throw new Error('HERMES_PUBLISH_FAILED');
      await response.body?.cancel();
    }
    try {
      await this.models(profile);
      return { profile, ready: true };
    } catch {
      return { profile, ready: false };
    }
  }

  async resolve(alias: string): Promise<{ url: string; model: string; key: string }> {
    let profile = 'default';
    let requested: string | undefined;
    if (alias.startsWith('Agent: ')) {
      profile = alias.slice(7);
      if (
        !(await this.profiles()).some((p) => p.name === profile) ||
        profileAlias(profile) !== alias
      ) {
        throw new Error('HERMES_UNKNOWN_PROFILE');
      }
    } else if (alias.startsWith('Model: ')) {
      requested = alias.slice(7);
      if (modelAlias(requested) !== alias) throw new Error('HERMES_UNKNOWN_MODEL');
    } else {
      throw new Error('HERMES_UNKNOWN_MODEL');
    }
    const models = await this.models(profile);
    const model = requested ?? models[0].id;
    if (!models.some((m) => m.id === model)) throw new Error('HERMES_UNKNOWN_MODEL');
    return {
      url: `${this.config.runtimeURL}${this.path(profile)}/chat/completions`,
      model,
      key: this.key(profile),
    };
  }
}
