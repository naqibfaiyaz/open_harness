import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QueryKeys, signupPaths, signupRequest } from 'librechat-data-provider';
import type { SignupState } from 'librechat-data-provider';

export function signupCall<T>(path: string, body?: object): Promise<T> {
  const base = document.querySelector('base')?.getAttribute('href') ?? '/';
  return signupRequest<T>(path, body, base);
}
export function useSignup() {
  const cache = useQueryClient();
  const config = useQuery(
    [QueryKeys.signup, 'config'],
    () => signupCall<{ enabled: boolean }>(signupPaths.config),
    { retry: false },
  );
  const status = useQuery(
    [QueryKeys.signup, 'status'],
    () => signupCall<SignupState>(signupPaths.status, {}),
    {
      enabled: config.data?.enabled === true,
      retry: false,
      refetchInterval: (data) => (data?.status === 'provisioning' ? 3000 : false),
    },
  );
  const mutation = useMutation(
    ({ path, body }: { path: string; body: object }) => signupCall<SignupState>(path, body),
    {
      onSuccess: (_data, variables) => {
        if (variables.path !== signupPaths.start)
          void cache.invalidateQueries([QueryKeys.signup, 'status']);
      },
    },
  );
  return { config, status, mutation };
}
