import type { TAttachment } from 'librechat-data-provider';
import type { HermesDeliveryStorage } from './deliveries';
import type { LocalStoragePaths } from '../storage/local';
import { saveLocalBuffer } from '../storage/local';

export function createHermesDeliveryStorage(deps: {
  paths: LocalStoragePaths;
  createFile: (data: Record<string, unknown>, disableTTL?: boolean) => Promise<unknown>;
}): HermesDeliveryStorage {
  return {
    async save(data) {
      const { buffer, ...record } = data;
      const filepath = await saveLocalBuffer({
        paths: deps.paths,
        userId: data.user,
        buffer,
        fileName: `${data.file_id}-${data.filename}`,
        basePath: 'uploads',
      });
      const saved = await deps.createFile({ ...record, filepath }, true);
      if (!saved) throw new Error('HERMES_FILE_SAVE_FAILED');
      return {
        ...record,
        toolCallId: `hermes-delivery-${data.messageId}`,
        filepath: `/api/files/download/${data.user}/${data.file_id}`,
      } as TAttachment;
    },
  };
}
