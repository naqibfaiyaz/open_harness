import type { TMessage } from 'librechat-data-provider';

/** Runtime header context uses the allocated assistant ID, not the optimistic user ID. */
export function hermesProgressTurn(
  messages: readonly TMessage[] | null | undefined,
  submission:
    | {
        initialResponse?: { parentMessageId?: string | null };
        userMessage?: { messageId?: string };
      }
    | null
    | undefined,
): string | undefined {
  const parent = submission?.initialResponse?.parentMessageId ?? submission?.userMessage?.messageId;
  if (!parent) return undefined;
  return messages?.findLast(
    (message) => !message.isCreatedByUser && message.parentMessageId === parent,
  )?.messageId;
}
