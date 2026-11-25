import { QueryKeys, organizationApiKeyPath } from 'librechat-data-provider';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { OrganizationApiKeysPage, CreatedOrganizationApiKey } from 'librechat-data-provider';
import { useAuthContext } from '~/hooks/AuthContext';
export function useOrganizationKeys() {
  const { token, user } = useAuthContext();
  const cache = useQueryClient();
  const key = [QueryKeys.organizationApiKeys, user?.id];
  const call = async <T>(path: string, method = 'GET', body?: object): Promise<T> => {
    const base = document.querySelector('base')?.getAttribute('href') ?? '/';
    const response = await fetch(`${base.replace(/\/$/, '')}${path}`, {
      method,
      credentials: 'same-origin',
      headers: { Authorization: `Bearer ${token ?? ''}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new Error('ORG_API_REQUEST_FAILED');
    return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
  };
  const page = useQuery(key, () => call<OrganizationApiKeysPage>(organizationApiKeyPath), {
    enabled: !!token && !!user?.id,
  });
  const create = useMutation(
    (body: object) => call<CreatedOrganizationApiKey>(organizationApiKeyPath, 'POST', body),
    { cacheTime: 0, onSuccess: () => cache.invalidateQueries(key) },
  );
  const revoke = useMutation(
    (id: string) => call<void>(`${organizationApiKeyPath}/${encodeURIComponent(id)}`, 'DELETE'),
    { onSuccess: () => cache.invalidateQueries(key) },
  );
  return { page, create, revoke };
}
