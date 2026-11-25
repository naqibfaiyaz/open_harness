export interface OrganizationApiKey {
  id: string;
  issuer: string;
  name: string;
  prefix: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  allowedModels: string[];
  revokedAt?: string;
  revokedBy?: string;
  lastUsedAt?: string;
}
export interface OrganizationApiKeyStore {
  create(record: OrganizationApiKey & { keyHash: string }): Promise<void>;
  countActive(issuer: string): Promise<number>;
  list(issuer: string): Promise<OrganizationApiKey[]>;
  find(keyHash: string, issuer: string): Promise<OrganizationApiKey | null>;
  revoke(id: string, issuer: string, actor: string): Promise<boolean>;
  touch(id: string, issuer: string): Promise<void>;
}
export interface OrganizationApiConfig {
  enabled: boolean;
  maxKeys: number;
  defaultExpiryDays: number;
  maxExpiryDays: number;
  requestsPerMinute: number;
  authRequestsPerMinute: number;
  maxConcurrent: number;
  maxOrgConcurrent: number;
  recheckMs: number;
  allowedOrigins: string[];
}
export interface OrganizationApiKeysPage {
  enabled: boolean;
  baseURL: string;
  keys: OrganizationApiKey[];
  defaultExpiryDays: number;
  maxExpiryDays: number;
}
export const organizationApiKeyPath = '/api/organization/api-keys';
export const organizationApiPath = '/api/agents/v1';

export interface CreatedOrganizationApiKey {
  key: OrganizationApiKey;
  secret: string;
}
