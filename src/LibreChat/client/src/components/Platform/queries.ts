import { QueryKeys, platformPaths } from 'librechat-data-provider';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  PlatformStatus,
  PlatformOrganization,
  PlatformAudit,
  OrganizationMember,
} from 'librechat-data-provider';
import { useAuthContext } from '~/hooks/AuthContext';

export function usePlatform(manage = false, slug?: string) {
  const { token, user } = useAuthContext();
  const cache = useQueryClient();
  const key = [QueryKeys.platform, user?.id];
  const call = async <T>(path: string, method = 'GET', body?: object): Promise<T> => {
    const base = document.querySelector('base')?.getAttribute('href') ?? '/';
    const response = await fetch(`${base.replace(/\/$/, '')}${path}`, {
      method,
      credentials: 'same-origin',
      headers: { Authorization: `Bearer ${token ?? ''}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new Error('PLATFORM_REQUEST_FAILED');
    return response.json() as Promise<T>;
  };
  const status = useQuery([...key, 'status'], () => call<PlatformStatus>(platformPaths.status), {
    enabled: !!token,
  });
  const enabled = !!token && manage && status.data?.canManage === true;
  const organizations = useQuery(
    [...key, 'organizations'],
    () => call<PlatformOrganization[]>(platformPaths.organizations),
    { enabled, refetchInterval: enabled ? 5000 : false },
  );
  const audit = useQuery([...key, 'audit'], () => call<PlatformAudit[]>(platformPaths.audit), {
    enabled,
    refetchInterval: enabled ? 10000 : false,
  });
  const members = useQuery(
    [...key, 'members', slug],
    () =>
      call<OrganizationMember[]>(
        `${platformPaths.organizations}/${encodeURIComponent(slug ?? '')}/members`,
      ),
    { enabled: enabled && !!slug },
  );
  const mutation = useMutation(
    ({ path, method, body }: { path: string; method: string; body: object }) =>
      call(path, method, body),
    { onSuccess: () => cache.invalidateQueries(key) },
  );
  return { status, organizations, audit, members, mutation };
}
