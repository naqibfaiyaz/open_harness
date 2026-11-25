export interface PlatformConfig {
  enabled: boolean;
  signup?: { requestLimit: number; windowMs: number };
  socketPath: string;
  bootstrapUserIds: string[];
  timeoutMs: number;
  requireMfa: boolean;
}
export interface PlatformStatus {
  enabled: boolean;
  canManage: boolean;
  recovery: boolean;
  needsMfa: boolean;
}
export interface PlatformOrganization {
  slug: string;
  name: string;
  status: 'provisioning' | 'active' | 'suspended' | 'failed';
  origin: string;
  ownerEmail: string;
  realm: string;
  errorCode?: string;
  createdAt: string;
  updatedAt: string;
  existing?: boolean;
}
export interface PlatformAudit {
  actor: string;
  action: string;
  target: string;
  at: string;
  outcome: string;
  reason: string;
}
export const platformPaths = {
  status: '/api/platform/status',
  organizations: '/api/platform/organizations',
  audit: '/api/platform/audit',
};

export interface SignupState {
  status?: 'verified' | 'provisioning' | 'active' | 'failed' | 'suspended';
  email?: string;
  slug?: string;
  origin?: string;
  sent?: boolean;
}
export interface SignupMailSettings {
  enabled: boolean;
  requestedEnabled: boolean;
  host: string;
  port: number;
  sender: string;
  username: string;
  passwordConfigured: boolean;
}
export const signupPaths = {
  config: '/api/signup/config',
  start: '/api/signup/start',
  verify: '/api/signup/verify',
  status: '/api/signup/status',
  create: '/api/signup/create',
  settings: '/api/platform/signup-settings',
};

export async function signupRequest<T>(path: string, body?: object, base = '/'): Promise<T> {
  const response = await fetch(`${base.replace(/\/$/, '')}${path}`, {
    method: body ? 'POST' : 'GET',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await response.json()) as T & { code?: string };
  if (!response.ok) throw new Error(data.code ?? 'SIGNUP_UNAVAILABLE');
  return data;
}
