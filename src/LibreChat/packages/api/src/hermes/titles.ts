/** Private metadata model: title generation must never start a Hermes tool session. */
export const HERMES_TITLE_MODEL = '__hermes_chat_title__';

export function firstPromptTitle(messages: unknown[]): string {
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    const { role, content } = message as { role?: string; content?: unknown };
    if (role !== 'user') continue;
    let text = typeof content === 'string' ? content : '';
    if (Array.isArray(content)) {
      text = content
        .map((part) => (part?.type === 'text' && typeof part.text === 'string' ? part.text : ''))
        .join(' ');
    }
    // Match LibreChat's default five-word title convention; this is display formatting,
    // not a request limit. Keep the original wording rather than inventing a summary.
    const words = text.trim().split(/\s+/u).filter(Boolean);
    if (words.length) return words.slice(0, 5).join(' ');
  }
  return 'Attachment conversation';
}
