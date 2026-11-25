import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createOrganizationApiKeyModel } from '../models/organizationApiKey';
import { createOrganizationApiKeyMethods } from './organizationApiKey';
let mongo: MongoMemoryServer;
const store = createOrganizationApiKeyMethods(mongoose).organizationApiKeyStore;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  createOrganizationApiKeyModel(mongoose);
  await mongoose.connect(mongo.getUri());
  await mongoose.models.OrganizationApiKey.createIndexes();
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});
it('binds stored digests to issuer, hides hashes in metadata and rejects revoked or expired keys', async () => {
  const base = {
    id: 'key-a',
    issuer: 'issuer-a',
    name: 'Integration',
    prefix: 'fixture-prefix',
    createdBy: 'owner',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    allowedModels: ['Agent: default'],
    keyHash: 'a'.repeat(64),
  };
  await store.create(base);
  await store.create({ ...base, id: 'key-b', issuer: 'issuer-b' });
  expect((await store.find(base.keyHash, 'issuer-a'))?.id).toBe('key-a');
  expect(await store.find(base.keyHash, 'issuer-c')).toBeNull();
  expect(JSON.stringify(await store.list('issuer-a'))).not.toContain('keyHash');
  expect(await store.revoke('key-a', 'issuer-b', 'attacker')).toBe(false);
  expect(await store.revoke('key-a', 'issuer-a', 'owner')).toBe(true);
  expect(await store.find(base.keyHash, 'issuer-a')).toBeNull();
  expect((await store.find(base.keyHash, 'issuer-b'))?.id).toBe('key-b');
  await store.create({
    ...base,
    id: 'expired',
    keyHash: 'b'.repeat(64),
    expiresAt: new Date(0).toISOString(),
  });
  expect(await store.find('b'.repeat(64), 'issuer-a')).toBeNull();
  expect(await store.countActive('issuer-a')).toBe(0);
});
