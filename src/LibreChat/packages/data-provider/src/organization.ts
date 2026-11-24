export type OrganizationRole = 'owner' | 'admin' | 'user';
export interface OrganizationConfig {
  enabled: boolean;
  name: string;
  realm: string;
  issuer: string;
  adminURL: string;
  clientId: string;
  bootstrapUserIds: string[];
  timeoutMs: number;
  maxMembers: number;
}
export interface OrganizationStatus {
  enabled: boolean;
  name: string;
  role?: OrganizationRole;
  bootstrap?: boolean;
  accountURL?: string;
}
export interface OrganizationMember {
  id: string;
  email: string;
  enabled: boolean;
  role: OrganizationRole | 'pending';
}
export interface OrganizationConnection {
  alias: string;
  providerId: string;
  enabled: boolean;
}
export const organizationPaths = {
  status: '/api/organization',
  members: '/api/organization/members',
  identity: '/api/organization/identity',
  connections: '/api/organization/connections',
};
