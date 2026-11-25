import { Schema } from 'mongoose';
import type { Model } from 'mongoose';
import { applyTenantIsolation } from './plugins/tenantIsolation';
export interface OrganizationKeyDocument {
  _id: string;
  issuer: string;
  name: string;
  prefix: string;
  keyHash: string;
  createdBy: string;
  createdAt: Date;
  expiresAt: Date;
  allowedModels: string[];
  revokedAt?: Date;
  revokedBy?: string;
  lastUsedAt?: Date;
  tenantId?: string;
}
export function createOrganizationApiKeyModel(
  mongoose: typeof import('mongoose'),
): Model<OrganizationKeyDocument> {
  if (mongoose.models.OrganizationApiKey) return mongoose.models.OrganizationApiKey;
  const schema = new Schema<OrganizationKeyDocument>({
    _id: { type: String, required: true },
    issuer: { type: String, required: true },
    name: { type: String, required: true },
    prefix: { type: String, required: true },
    keyHash: { type: String, required: true, select: false },
    createdBy: { type: String, required: true },
    createdAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    allowedModels: { type: [String], default: [] },
    revokedAt: Date,
    revokedBy: String,
    lastUsedAt: Date,
  });
  schema.index({ issuer: 1, keyHash: 1 }, { unique: true });
  schema.index({ issuer: 1, createdAt: -1 });
  applyTenantIsolation(schema);
  return mongoose.model<OrganizationKeyDocument>('OrganizationApiKey', schema);
}
