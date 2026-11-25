import { useEffect, useState } from 'react';
import { request, apiBaseUrl } from 'librechat-data-provider';
import type { TAttachment, TAttachmentMetadata, TFile } from 'librechat-data-provider';
import LogLink from '~/components/Chat/Messages/Content/Parts/LogLink';
import { useShareContext } from '~/Providers';
import { useLocalize } from '~/hooks';

function GeneratedFile({ file }: { file: TFile }) {
  const { shareId } = useShareContext();
  const [preview, setPreview] = useState('');
  useEffect(() => {
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type ?? '') || (file.bytes ?? 0) > 6291456)
      return;
    const shared = !!shareId && file.filepath?.startsWith('/api/share/');
    if (shareId && !shared) return;
    const path = shared
      ? file.filepath
      : `/api/files/download/${encodeURIComponent(String(file.user))}/${encodeURIComponent(file.file_id ?? '')}`;
    if (!path) return;
    const abort = new AbortController();
    let url = '';
    const fetchFile = shared ? fetch : request.authenticatedFetch;
    void fetchFile(`${apiBaseUrl()}${path}`, { signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const blob = await response.blob();
        if (abort.signal.aborted || blob.size > 6291456) return;
        url = URL.createObjectURL(new Blob([blob], { type: file.type }));
        setPreview(url);
      })
      .catch(() => undefined);
    return () => {
      abort.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [file.file_id, file.filepath, file.user, file.type, file.bytes, shareId]);
  return (
    <li className="border-border-light space-y-2 rounded-xl border p-3">
      {preview && (
        <img
          src={preview}
          alt={file.filename}
          className="max-h-80 max-w-full rounded-lg object-contain"
          loading="lazy"
        />
      )}
      <LogLink
        href={file.filepath ?? ''}
        filename={file.filename ?? ''}
        file_id={file.file_id}
        user={String(file.user)}
        source={file.source}
      >
        {file.filename}
      </LogLink>
    </li>
  );
}

export default function GeneratedFiles({ attachments }: { attachments?: TAttachment[] }) {
  const localize = useLocalize();
  const files = (attachments ?? []).filter(
    (file): file is TFile & TAttachmentMetadata =>
      file.hermesGenerated === true && 'file_id' in file && 'user' in file && 'type' in file,
  );
  if (!files.length) return null;
  return (
    <section aria-label={localize('com_generated_files')} className="my-3 space-y-2">
      <h3 className="font-medium">{localize('com_generated_files')}</h3>
      <ul className="space-y-3">
        {files.map((file) => (
          <GeneratedFile key={file.file_id} file={file} />
        ))}
      </ul>
    </section>
  );
}
