import { Check, LoaderCircle, CirclePause } from 'lucide-react';
import { useHermesProgress } from './queries';
import { useLocalize } from '~/hooks';

const icons = { running: LoaderCircle, completed: Check, interrupted: CirclePause };
const statusKeys = {
  running: 'com_hermes_tool_running',
  completed: 'com_hermes_tool_completed',
  interrupted: 'com_hermes_tool_interrupted',
} as const;

export default function HermesProgress({
  conversation,
  turn,
  active,
}: {
  conversation?: string;
  turn?: string;
  active: boolean;
}) {
  const localize = useLocalize();
  const { data } = useHermesProgress(conversation, turn, active);
  if (!active || !data?.tools.length) return null;
  return (
    <details
      open
      className="bg-surface-secondary text-text-secondary border-border-light mx-auto mb-2 w-full max-w-3xl rounded-xl border px-4 py-2 text-sm"
      data-private
    >
      <summary className="cursor-pointer font-medium">{localize('com_hermes_activity')}</summary>
      <ul
        className="mt-2 max-h-40 space-y-2 overflow-y-auto"
        aria-live="polite"
        aria-relevant="additions text"
      >
        {data.tools.map((tool) => {
          const Icon = icons[tool.status];
          const status = localize(statusKeys[tool.status]);
          return (
            <li key={tool.id} className="flex items-center gap-2">
              <Icon
                aria-hidden
                className={`h-4 w-4 shrink-0 ${tool.status === 'running' ? 'motion-safe:animate-spin' : ''}`}
              />
              <span className="min-w-0 truncate" title={tool.tool}>
                {tool.tool.replace(/_/gu, ' ')}
              </span>
              <span className="ms-auto shrink-0 text-xs">{status}</span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
