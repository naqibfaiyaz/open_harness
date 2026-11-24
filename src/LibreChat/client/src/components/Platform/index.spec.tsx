import { render, screen } from '@testing-library/react';
import { usePlatform } from './queries';
import Platform from './index';
jest.mock('./queries', () => ({ usePlatform: jest.fn() }));
jest.mock('~/hooks', () => ({ useLocalize: () => (key: string) => key }));
const hook = usePlatform as jest.Mock;
const base = {
  status: { data: { enabled: true, canManage: true, recovery: false, needsMfa: false } },
  organizations: {
    data: [{ slug: 'example', name: 'Example', status: 'active', origin: 'https://example.test' }],
  },
  members: { data: [] },
  audit: { data: [] },
  mutation: { mutateAsync: jest.fn() },
};
it('rejects customer roles without showing provisioning controls', () => {
  hook.mockReturnValue({ ...base, status: { data: { enabled: true, canManage: false } } });
  render(<Platform />);
  expect(screen.getByRole('alert')).toHaveTextContent('com_platform_denied');
  expect(screen.queryByText('com_platform_create')).not.toBeInTheDocument();
});
it('requires MFA enrollment before showing internal management', () => {
  hook.mockReturnValue({ ...base, status: { data: { needsMfa: true, canManage: false } } });
  render(<Platform />);
  expect(screen.getByText('com_platform_mfa')).toBeInTheDocument();
  expect(screen.queryByText('com_platform_create')).not.toBeInTheDocument();
});
it('lists workspaces while requiring a reason before provisioning or suspension', () => {
  hook.mockReturnValue(base);
  render(<Platform />);
  expect(screen.getByText('Example')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'com_platform_create' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'com_platform_suspend' })).toBeDisabled();
  expect(screen.getByText('com_platform_scope')).toBeInTheDocument();
});
