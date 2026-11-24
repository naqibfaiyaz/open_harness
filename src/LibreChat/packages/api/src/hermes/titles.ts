/** Private metadata model: title generation must never start a Hermes tool session. */
export const HERMES_TITLE_MODEL = '__hermes_chat_title__';

export async function generatePromptTitle(
  messages: unknown[],
  request: (prompt: string) => Promise<string>,
): Promise<string> {
  const prompt = firstPromptText(messages);
  if (!prompt) return 'Attachment conversation';
  try {
    // Match the metadata plugin's payload contract; no attachment bytes or later turns.
    const title = (await request(prompt.slice(0, 8000))).trim().replace(/^["“]|["”]$/gu, '');
    if (title && !title.includes('\n') && title.length <= 120) return title;
  } catch {
    // Naming failures must not fail the chat or initiate another agent turn.
  }
  return firstPromptTitle(messages);
}

export function firstPromptText(messages: unknown[]): string {
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
    if (text.trim()) return text.trim();
  }
  return '';
}

export function firstPromptTitle(messages: unknown[]): string {
  return (
    firstPromptText(messages).split(/\s+/u).filter(Boolean).slice(0, 5).join(' ') ||
    'Attachment conversation'
  );
}
