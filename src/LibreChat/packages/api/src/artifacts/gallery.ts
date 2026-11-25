import { Router } from 'express';
import type { GalleryPage, GalleryArtifact } from 'librechat-data-provider';
import type { RequestHandler } from 'express';
import { findAllArtifacts } from './update';

export function galleryArtifacts(page: GalleryPage, query = ''): GalleryArtifact[] {
  return page.messages
    .flatMap((message) => [
      ...findAllArtifacts(message).map((boundary) => {
        const source = boundary.text.slice(boundary.start, boundary.end);
        const header = source.slice(0, source.indexOf('\n'));
        const attribute = (name: string, fallback: string) =>
          new RegExp(`\\b${name}=(["'])(.*?)\\1`).exec(header)?.[2] ?? fallback;
        const identifier = attribute('identifier', 'lc-no-identifier');
        const title = attribute('title', 'untitled');
        const type = attribute('type', 'unknown');
        const id = `${identifier}_${type}_${title}_${message.messageId}`
          .replace(/\s+/g, '_')
          .toLowerCase();
        let content = source
          .slice(header.length)
          .trim()
          .replace(/\n:::\s*$/, '')
          .trim();
        const fence = /^(`{3,}|~{3,})[^\n]*\n/.exec(content);
        if (fence) {
          content = content.slice(fence[0].length);
          const close = new RegExp(`\\n${fence[1]}\\s*$`);
          content = content.replace(close, '');
        }
        return {
          id,
          title,
          type,
          content,
          messageId: message.messageId,
          conversationId: message.conversationId,
        };
      }),
      ...(message.attachments ?? [])
        .filter((attachment) =>
          /\.(html?|svg|md|markdown|tsx?|jsx?|py|json|ya?ml|toml|csv|xlsx?|docx|odt|pptx|txt|css|sql|rs|go|sh|mmd|mermaid)$/i.test(
            attachment.filename,
          ),
        )
        .map((attachment) => {
          const extension = attachment.filename.split('.').pop()?.toLowerCase() ?? '';
          const types: Record<string, string> = {
            html: 'text/html',
            svg: 'image/svg+xml',
            md: 'text/markdown',
            tsx: 'application/vnd.react',
            jsx: 'application/vnd.react',
          };
          return {
            id: `tool-artifact-${attachment.file_id}`,
            title: attachment.filename,
            type: types[extension] ?? 'text/plain',
            content: attachment.content,
            messageId: message.messageId,
            conversationId: message.conversationId,
          };
        }),
    ])
    .filter(
      (artifact) =>
        !query ||
        `${artifact.title}\n${artifact.content}`.toLowerCase().includes(query.toLowerCase()),
    )
    .map((artifact) => ({ ...artifact, content: artifact.content.slice(0, 12000) }));
}
export function createArtifactGalleryRouter(deps: {
  authenticate: RequestHandler;
  list: (user: string, before?: string, query?: string) => Promise<GalleryPage>;
}): Router {
  const router = Router();
  router.use(deps.authenticate);
  router.get('/', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const user = (req as typeof req & { user?: { id?: string; _id?: object } }).user;
    const id = user?.id ?? user?._id?.toString();
    const before = typeof req.query.before === 'string' ? req.query.before : undefined;
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!id) {
      res.status(401).json({ code: 'ARTIFACT_AUTH_REQUIRED' });
      return;
    }
    if ((before && !/^[a-f0-9]{24}$/.test(before)) || query.length > 100) {
      res.status(400).json({ code: 'ARTIFACT_INVALID_QUERY' });
      return;
    }
    void deps
      .list(id, before, query)
      .then((page) => {
        const artifacts = galleryArtifacts(page, query);
        res.json({ artifacts, nextCursor: page.nextCursor });
      })
      .catch(() => res.status(503).json({ code: 'ARTIFACT_GALLERY_UNAVAILABLE' }));
  });
  return router;
}
