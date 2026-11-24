import { randomUUID } from 'node:crypto';

export interface HermesToolProgress {
  id: string;
  tool: string;
  status: 'running' | 'completed' | 'interrupted';
}
interface ProgressRun {
  id: string;
  active: boolean;
  updatedAt: number;
  tools: HermesToolProgress[];
}
export interface ProgressLimits {
  maxRuns: number;
  maxTools: number;
  retentionMs: number;
}

/** Ephemeral presentation state only. No tool arguments, results or credentials are retained. */
export class HermesProgress {
  private runs = new Map<string, ProgressRun>();
  constructor(private limits: ProgressLimits) {}
  private key(user: string, conversation: string, turn: string) {
    return JSON.stringify([user, conversation, turn]);
  }

  private prune() {
    const before = Date.now() - this.limits.retentionMs;
    for (const [key, run] of this.runs) if (run.updatedAt < before) this.runs.delete(key);
  }

  get(user: string, conversation: string, turn: string) {
    this.prune();
    return this.runs.get(this.key(user, conversation, turn)) ?? null;
  }

  current(user: string, conversation: string) {
    this.prune();
    for (const [key, run] of this.runs) {
      const [owner, chat] = JSON.parse(key) as string[];
      if (owner === user && chat === conversation) return run.active ? run : null;
    }
    return null;
  }

  begin(user: string, conversation: string, turn: string) {
    this.prune();
    // LibreChat admits one foreground generation per conversation. Retire its previous
    // presentation lease immediately; delayed callbacks cannot revive an older run.
    for (const key of this.runs.keys()) {
      const [owner, chat] = JSON.parse(key) as string[];
      if (owner === user && chat === conversation) this.runs.delete(key);
    }
    const key = this.key(user, conversation, turn);
    const run: ProgressRun = { id: randomUUID(), active: true, updatedAt: Date.now(), tools: [] };
    this.runs.delete(key);
    this.runs.set(key, run);
    while (this.runs.size > this.limits.maxRuns) this.runs.delete(this.runs.keys().next().value!);
    return {
      event: (payload: unknown) => {
        if (this.runs.get(key) !== run || !run.active || !payload || typeof payload !== 'object')
          return;
        const item = payload as Record<string, unknown>;
        if (
          typeof item.toolCallId !== 'string' ||
          typeof item.tool !== 'string' ||
          item.toolCallId.length > 257 ||
          !/^[\w.-]{1,128}$/u.test(item.tool) ||
          !['running', 'completed'].includes(String(item.status))
        )
          return;
        const current = run.tools.find((tool) => tool.id === item.toolCallId);
        if (current) {
          // Duplicate/out-of-order starts must not revive a completed tool.
          if (item.status === 'completed') current.status = 'completed';
        } else {
          if (run.tools.length >= this.limits.maxTools) return;
          run.tools.push({
            id: item.toolCallId,
            tool: item.tool,
            status: item.status as 'running' | 'completed',
          });
        }
        run.updatedAt = Date.now();
      },
      finish: () => {
        if (this.runs.get(key) !== run) return;
        run.active = false;
        run.updatedAt = Date.now();
        for (const tool of run.tools) if (tool.status === 'running') tool.status = 'interrupted';
      },
    };
  }
}

/** Observe SSE as bytes pass through unchanged, including UTF-8 and split CRLF frames. */
export function observeHermesProgress(
  event: (payload: unknown) => void,
  finish: () => void,
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  let pending = '';
  // Metadata framing guard only: oversized frames are ignored, never change chat bytes.
  let dropping = false;
  const consume = (text: string) => {
    pending += text;
    let boundary: RegExpExecArray | null;
    while ((boundary = /\r?\n\r?\n/u.exec(pending))) {
      const frame = pending.slice(0, boundary.index);
      pending = pending.slice(boundary.index + boundary[0].length);
      if (!dropping && frame.length <= 64 * 1024) {
        const lines = frame.split(/\r?\n/u);
        const name = lines
          .find((line) => line.startsWith('event:'))
          ?.slice(6)
          .trim();
        if (name === 'hermes.tool.progress') {
          try {
            event(
              JSON.parse(
                lines
                  .filter((line) => line.startsWith('data:'))
                  .map((line) => line.slice(5).trimStart())
                  .join('\n'),
              ),
            );
          } catch {
            /* Invalid metadata must not interrupt an otherwise valid model response. */
          }
        }
      }
      dropping = false;
    }
    if (pending.length > 64 * 1024) {
      pending = pending.slice(-1);
      dropping = true;
    }
  };
  return new TransformStream({
    transform(chunk, controller) {
      consume(decoder.decode(chunk, { stream: true }));
      controller.enqueue(chunk);
    },
    flush() {
      consume(decoder.decode());
      finish();
    },
  });
}
