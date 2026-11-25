import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createMessageMethods } from './message';
import { createModels } from '../models';
jest.mock('~/config/winston', () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }));
let server: MongoMemoryServer;
const methods = createMessageMethods(mongoose);
beforeAll(async () => { server = await MongoMemoryServer.create(); Object.assign(mongoose.models, createModels(mongoose)); await mongoose.connect(server.getUri()); });
afterAll(async () => { await mongoose.disconnect(); await server?.stop(); });
it('isolates artifacts by user, excludes expired messages and treats search characters literally', async () => {
  await mongoose.models.Message.collection.insertMany([
    { messageId: 'mine', conversationId: 'chat-a', user: 'owner-a', isCreatedByUser: false, text: ':::artifact{title="Report [Q1]"}\nhello\n:::' },
    { messageId: 'other', conversationId: 'chat-b', user: 'owner-b', isCreatedByUser: false, text: ':::artifact{title="Report [Q1]"}\nprivate\n:::' },
    { messageId: 'expired', conversationId: 'chat-c', user: 'owner-a', isCreatedByUser: false, text: ':::artifact{title="Report [Q1]"}\nexpired\n:::', expiredAt: new Date(0) },
  ]);
  const page = await methods.getArtifactGalleryMessages('owner-a', undefined, '[Q1]');
  expect(page.messages.map((message) => message.messageId)).toEqual(['mine']);
  expect((await methods.getArtifactGalleryMessages('owner-a', undefined, '.*')).messages).toEqual([]);
});
