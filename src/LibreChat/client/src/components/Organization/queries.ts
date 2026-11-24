import { QueryKeys, organizationPaths } from 'librechat-data-provider';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  OrganizationStatus,
  OrganizationMember,
  OrganizationConnection,
} from 'librechat-data-provider';
import { useAuthContext } from '~/hooks/AuthContext';

export function useOrganization(manage = false) {
  const { token, user } = useAuthContext();
  const cache = useQueryClient();
  const key = [QueryKeys.organization, user?.id];
  const call = async <T>(path: string, method = 'GET', body?: object): Promise<T> => {
    const base = document.querySelector('base')?.getAttribute('href') ?? '/';
    const response = await fetch(`${base.replace(/\/$/, '')}${path}`, {
      method,
      credentials: 'same-origin',
      headers: { Authorization: `Bearer ${token ?? ''}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new Error('ORG_REQUEST_FAILED');
    return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
  };
  const status = useQuery(
    [...key, 'status'],
    () => call<OrganizationStatus>(organizationPaths.status),
    { enabled: !!token },
  );
  const manager = manage && (status.data?.role === 'owner' || status.data?.role === 'admin');
  const members = useQuery(
    [...key, 'members'],
    () => call<OrganizationMember[]>(organizationPaths.members),
    { enabled: !!token && manager },
  );
  const connections = useQuery(
    [...key, 'connections'],
    () => call<OrganizationConnection[]>(organizationPaths.connections),
    { enabled: !!token && manage && status.data?.role === 'owner' },
  );
  const mutation = useMutation(
    ({ path, method, body }: { path: string; method: string; body?: object }) =>
      call(path, method, body),
    { onSuccess: () => cache.invalidateQueries(key) },
  );
  return { status, members, connections, mutation };
}
