import { createHash } from 'node:crypto';
import { FileContext, FileSources } from 'librechat-data-provider';
import type { TAttachment } from 'librechat-data-provider';
import type { HermesDashboard } from './dashboard';
import type { HermesConfig } from './config';
import { sessionKey } from './sessions';

export const deliveryDirectory = (key: string, user: string, conversation: string): string =>
  `/opt/data/cache/librechat-deliveries/${sessionKey(key, user, conversation)}`;

export function hermesPresentationInstructions(directory: string, interactive: boolean): string {
  return [
    'LIBRECHAT DELIVERY CONTRACT (applies to this frontend, including when a skill suggests another output format):',
    interactive
      ? 'For graphs, charts, visualizations, reports with graphs, or dashboards, prioritize a working interactive LibreChat artifact. Do not deliver only a static PNG, Python script, or file path. Use a self-contained HTML artifact with inline SVG and JavaScript, accessible controls, hover/focus values, and useful filters or metric switches. Embed the actual queried data; never invent data. Clearly label its period, currency, units, source and limitations. If data is missing, ask for it instead of fabricating a chart. Use no external network resources. React is also supported when appropriate.'
      : '',
    'Return interactive HTML in this exact wrapper (not an escaped string or a code fence around the wrapper):',
    ':::artifact{identifier="descriptive-stable-id" type="text/html" title="Descriptive title"}',
    '```html',
    '<!doctype html><html>...complete working interactive document...</html>',
    '```',
    ':::',
    'For follow-up edits, return the complete updated artifact using the same identifier. Keep the artifact in the assistant response so LibreChat can save, preview and share it.',
    `Supporting downloadable outputs must be written directly into ${directory}/ (create the directory if needed). Use simple filenames without subdirectories. Announce each completed file as MEDIA:${directory}/filename.ext on its own line. LibreChat imports only this conversation-specific directory. Never claim that a filesystem path alone is a delivered attachment. Do not emit MEDIA markers inside an interactive artifact.`,
    'A static image, CSV, PDF or workbook is a supporting download; prefer the interactive artifact for visualization requests unless the user explicitly requests only a static/export format. Preserve user instructions and existing artifact styling. Do not run tools merely to answer ordinary text questions.',
  ]
    .filter(Boolean)
    .join('\n');
}

interface OutputMessage {
  messageId: string;
  conversationId: string;
  text?: string;
  content?: { type: string; text?: string | { value?: string } }[];
  attachments?: TAttachment[];
}
function rewriteMedia(text: string, replace: (path: string, marker: string) => string): string {
  let artifact = false;
  let fence = '';
  return text
    .split('\n')
    .map((line) => {
      if (/^\s*:::artifact\b/.test(line)) {
        artifact = true;
        return line;
      }
      if (artifact) {
        if (/^\s*:::\s*$/.test(line)) artifact = false;
        return line;
      }
      const boundary = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
      if (boundary) {
        if (!fence) fence = boundary;
        else if (boundary[0] === fence[0] && boundary.length >= fence.length) fence = '';
        return line;
      }
      if (fence) return line;
      return line.replace(
        /MEDIA:\s*(?:["']([^"'\r\n]+)["']|([^\s<>`"']+))/g,
        (marker, quoted, bare) => replace(quoted ?? bare, marker),
      );
    })
    .join('\n');
}
export interface HermesDeliveryStorage {
  save(data: {
    user: string;
    conversationId: string;
    messageId: string;
    file_id: string;
    filename: string;
    bytes: number;
    type: string;
    buffer: Buffer;
    source: FileSources;
    context: FileContext;
  }): Promise<TAttachment>;
}

/** Only trusted server identity selects the export directory; model paths cannot select another session. */
export function createHermesDeliveryHandler(deps: {
  dashboard: HermesDashboard;
  config: HermesConfig;
  bridgeKey: string;
  storage: HermesDeliveryStorage;
}): (user: string, message: OutputMessage) => Promise<void> {
  return async (user, message) => {
    if (!deps.config.deliverFiles || !message.conversationId || !message.messageId) return;
    const directory = deliveryDirectory(deps.bridgeKey, user, message.conversationId);
    const texts = [
      message.text ?? '',
      ...(message.content ?? []).map((p) =>
        typeof p.text === 'string' ? p.text : (p.text?.value ?? ''),
      ),
    ];
    const found = new Set<string>();
    for (const text of texts)
      rewriteMedia(text, (path, marker) => {
        found.add(path);
        return marker;
      });
    const paths = [...found];
    const replacements = new Map<string, string>();
    for (const path of paths.slice(0, deps.config.deliveryMaxFiles ?? 8)) {
      const filename = path.slice(directory.length + 1);
      if (
        !path.startsWith(`${directory}/`) ||
        !/^[A-Za-z0-9][A-Za-z0-9._ -]{0,179}$/.test(filename) ||
        filename === '..'
      ) {
        replacements.set(
          path,
          '[File not attached: ask the agent to export it to this conversation’s delivery directory.]',
        );
        continue;
      }
      try {
        const maxBytes = deps.config.deliveryMaxBytes ?? 20971520;
        const response = await deps.dashboard.fetch('/api/plugins/open-harness-titles/file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Open-Harness-Key': deps.bridgeKey },
          body: JSON.stringify({
            session: sessionKey(deps.bridgeKey, user, message.conversationId),
            filename,
            max_bytes: maxBytes,
          }),
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error('HERMES_FILE_UNAVAILABLE');
        }
        const reader = response.body?.getReader();
        if (!reader) throw new Error('HERMES_FILE_UNAVAILABLE');
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > maxBytes) throw new Error('HERMES_FILE_TOO_LARGE');
            chunks.push(value);
          }
        } finally {
          await reader.cancel();
        }
        const buffer = Buffer.concat(chunks);
        const digest = createHash('sha256')
          .update(JSON.stringify([user, message.conversationId, message.messageId, filename]))
          .update(buffer)
          .digest('hex');
        const file_id = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
        const file = await deps.storage.save({
          user,
          conversationId: message.conversationId,
          messageId: message.messageId,
          file_id,
          filename,
          bytes: buffer.length,
          type: response.headers.get('content-type')?.split(';')[0] ?? 'application/octet-stream',
          buffer,
          source: FileSources.local,
          context: FileContext.message_attachment,
        });
        message.attachments ??= [];
        if (!message.attachments.some((a) => 'file_id' in a && a.file_id === file_id))
          message.attachments.push({ ...file, hermesGenerated: true } as TAttachment);
        replacements.set(path, `[Attached file: ${filename}]`);
      } catch {
        replacements.set(path, '[File attachment failed. Ask the agent to retry the export.]');
      }
    }
    const replace = (text: string) =>
      rewriteMedia(
        text,
        (path) =>
          replacements.get(path) ??
          '[File count limit reached. Ask the agent to export the remaining files in another message.]',
      );
    if (message.text) message.text = replace(message.text);
    for (const part of message.content ?? []) {
      if (typeof part.text === 'string') part.text = replace(part.text);
      else if (part.text?.value) part.text.value = replace(part.text.value);
    }
  };
}
