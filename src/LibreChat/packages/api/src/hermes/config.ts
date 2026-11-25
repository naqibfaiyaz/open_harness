export interface HermesConfig {
  enabled: boolean;
  managedOnly: boolean;
  artifactsEnabledByDefault?: boolean;
  publicOrigin: string;
  dashboardURL: string;
  runtimeURL: string;
  allowedUserIds: string[];
  endpointName: string;
  progressMaxRuns?: number;
  progressMaxTools?: number;
  progressRetentionMs?: number;
}

export interface HermesSecrets {
  dashboardUsername: string;
  dashboardPassword: string;
  dashboardProvider: string;
  runtimeKey: string;
  bridgeKey: string;
}

export interface HermesUser {
  id?: string;
  _id?: unknown;
  role?: string;
  organizationRole?: 'owner' | 'admin' | 'user';
}

export function canManageHermes(user: HermesUser | undefined, config: HermesConfig): boolean {
  if (!user) return false;
  const id = user.id ?? String(user._id ?? '');
  if (user.organizationRole) return config.enabled && user.organizationRole !== 'user';
  return config.enabled && (user.role === 'ADMIN' || config.allowedUserIds.includes(id));
}

export function validateHermesConfig(config: HermesConfig, secrets: HermesSecrets): void {
  for (const value of [config.dashboardURL, config.runtimeURL, config.publicOrigin]) {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    )
      throw new Error('Invalid Hermes URL');
  }
  if (
    secrets.bridgeKey.length < 32 ||
    !secrets.runtimeKey ||
    !secrets.dashboardUsername ||
    !secrets.dashboardPassword ||
    !secrets.dashboardProvider
  ) {
    throw new Error('Hermes integration secrets are incomplete');
  }
}
