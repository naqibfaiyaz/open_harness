import { useMemo } from 'react';
import DOMPurify from 'dompurify';
import { useLocalize } from '~/hooks';

export default function Thumbnail({
  content = '',
  type = '',
  title = '',
}: {
  content?: string;
  type?: string;
  title?: string;
}) {
  const localize = useLocalize();
  const html = useMemo(() => {
    if (!['text/html', 'image/svg+xml'].includes(type)) return '';
    const safe = DOMPurify.sanitize(content.slice(0, 12000), {
      FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'link', 'meta', 'base'],
    });
    return `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'"><meta name="viewport" content="width=device-width">${safe}`;
  }, [content, type]);
  return (
    <div
      className="border-border-light bg-surface-secondary relative h-36 w-full overflow-hidden rounded-lg border"
      aria-hidden="true"
    >
      {html ? (
        <iframe
          title={title || localize('com_gallery_preview')}
          sandbox=""
          srcDoc={html}
          tabIndex={-1}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="pointer-events-none h-full w-full border-0"
        />
      ) : (
        <div className="text-text-secondary space-y-2 p-4">
          <pre className="line-clamp-4 text-xs break-words whitespace-pre-wrap">
            {content.slice(0, 500)}
          </pre>
          <span className="text-text-tertiary block truncate text-xs">{type}</span>
        </div>
      )}
    </div>
  );
}
