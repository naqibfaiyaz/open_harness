import type { OrganizationApiKey, OrganizationApiKeyStore } from 'librechat-data-provider';
import type { OrganizationKeyDocument } from '../models/organizationApiKey';
export function createOrganizationApiKeyMethods(mongoose: typeof import('mongoose')): {
  organizationApiKeyStore: OrganizationApiKeyStore;
} {
  const model = () =>
    mongoose.models.OrganizationApiKey as import('mongoose').Model<OrganizationKeyDocument>;
  const publicRecord = (row: OrganizationKeyDocument): OrganizationApiKey => ({
    id: row._id,
    issuer: row.issuer,
    name: row.name,
    prefix: row.prefix,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    allowedModels: row.allowedModels,
    revokedAt: row.revokedAt?.toISOString(),
    revokedBy: row.revokedBy,
    lastUsedAt: row.lastUsedAt?.toISOString(),
  });
  return {
    organizationApiKeyStore: {
      async create(record) {
        const { id, ...rest } = record;
        await model().create({ ...rest, _id: id });
      },
      async countActive(issuer) {
        return model().countDocuments({ issuer, revokedAt: null, expiresAt: { $gt: new Date() } });
      },
      async list(issuer) {
        const now = new Date();
        const [active, retired] = await Promise.all([
          model()
            .find({ issuer, revokedAt: null, expiresAt: { $gt: now } })
            .sort({ createdAt: -1 })
            .limit(500)
            .lean(),
          model()
            .find({ issuer, $or: [{ revokedAt: { $ne: null } }, { expiresAt: { $lte: now } }] })
            .sort({ createdAt: -1 })
            .limit(100)
            .lean(),
        ]);
        return [...active, ...retired].map(publicRecord);
      },
      async find(keyHash, issuer) {
        const row = await model()
          .findOne({ keyHash, issuer, revokedAt: null, expiresAt: { $gt: new Date() } })
          .lean();
        return row ? publicRecord(row) : null;
      },
      async revoke(id, issuer, actor) {
        const result = await model().updateOne(
          { _id: id, issuer, revokedAt: null },
          { $set: { revokedAt: new Date(), revokedBy: actor } },
        );
        return result.modifiedCount === 1;
      },
      async touch(id, issuer) {
        await model().updateOne({ _id: id, issuer }, { $set: { lastUsedAt: new Date() } });
      },
    },
  };
}
