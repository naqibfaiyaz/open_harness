export interface PlatformConfig {
  enabled: boolean;
  socketPath: string;
  bootstrapUserIds: string[];
  timeoutMs: number;
  requireMfa: boolean;
}
export interface PlatformStatus { enabled: boolean; canManage: boolean; recovery: boolean; needsMfa: boolean; }
export interface PlatformOrganization {
  slug: string; name: string; status: 'provisioning' | 'active' | 'suspended' | 'failed';
  origin: string; ownerEmail: string; realm: string; errorCode?: string;
  createdAt: string; updatedAt: string; existing?: boolean;
}
export interface PlatformAudit { actor: string; action: string; target: string; at: string; outcome: string; reason: string; }
export const platformPaths = { status: '/api/platform/status', organizations: '/api/platform/organizations', audit: '/api/platform/audit' };
