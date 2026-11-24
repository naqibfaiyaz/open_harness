import { QueryKeys } from 'librechat-data-provider';
import { useQuery, useMutation } from '@tanstack/react-query';
import type {
  HermesStatus,
  HermesProfiles,
  HermesWorkspaceSession,
  HermesPublishResult,
  HermesProgressSnapshot,
} from 'librechat-data-provider';
import { useAuthContext } from '~/hooks/AuthContext';

async function call<T>(
  token: string | undefined,
  path: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const base = document.querySelector('base')?.getAttribute('href') ?? '/';
  const route = path === '/session' ? '/hermes-workspace/_session' : `/api/hermes${path}`;
  const response = await fetch(`${base.replace(/\/$/, '')}${route}`, {
    method,
    signal,
    credentials: 'same-origin',
    headers: { Authorization: `Bearer ${token ?? ''}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error('HERMES_REQUEST_FAILED');
  return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
}

export function useHermesProgress(
  conversation: string | undefined,
  turn: string | undefined,
  enabled: boolean,
) {
  const { token, user } = useAuthContext();
  return useQuery<HermesProgressSnapshot | null>(
    ['hermes-progress', user?.id, conversation, turn],
    ({ signal }) =>
      call(
        token,
        `/progress/${encodeURIComponent(conversation ?? '')}/${encodeURIComponent(turn ?? '')}`,
        'GET',
        undefined,
        signal,
      ),
    {
      enabled: enabled && !!token && !!conversation && conversation !== 'new' && !!turn,
      refetchInterval: enabled ? 1000 : false,
      refetchOnWindowFocus: false,
      retry: false,
      cacheTime: 0,
    },
  );
}

export function useHermesStatus() {
  const { token, user } = useAuthContext();
  return useQuery<HermesStatus>([QueryKeys.hermesStatus, user?.id], () => call(token, '/status'), {
    enabled: !!token,
    staleTime: 30_000,
    retry: false,
  });
}
export function useHermesProfiles(enabled: boolean) {
  const { token, user } = useAuthContext();
  return useQuery<HermesProfiles>(
    [QueryKeys.hermesProfiles, user?.id],
    () => call(token, '/profiles'),
    {
      enabled: enabled && !!token,
      retry: false,
    },
  );
}
export function useHermesSession() {
  const { token } = useAuthContext();
  return useMutation(() => call<HermesWorkspaceSession>(token, '/session', 'POST'));
}
export function usePublishHermesProfile() {
  const { token } = useAuthContext();
  return useMutation((profile: string) =>
    call<HermesPublishResult>(token, '/publish', 'POST', { profile }),
  );
}
