import { useQuery } from '@tanstack/react-query';
import { QueryKeys, signupPaths } from 'librechat-data-provider';
import { signupCall } from './signupQueries';
import { useLocalize } from '~/hooks';

export default function SignupLink() {
  const localize = useLocalize();
  const { data } = useQuery(
    [QueryKeys.signup, 'config'],
    () => signupCall<{ enabled: boolean }>(signupPaths.config),
    { retry: false },
  );
  return data?.enabled ? (
    <a className="my-4 block text-center underline" href="./signup">
      {localize('com_signup_title')}
    </a>
  ) : null;
}
