import { act, fireEvent, render, screen } from '@testing-library/react';
import { useSignup } from './signupQueries';
import Signup from './Signup';
jest.mock('./signupQueries', () => ({ useSignup: jest.fn() }));
jest.mock('~/hooks', () => ({ useLocalize: () => (key: string) => key }));
const hook = useSignup as jest.Mock;
const base = {
  config: { data: { enabled: true } },
  status: { data: {} },
  mutation: { mutateAsync: jest.fn().mockResolvedValue({}), reset: jest.fn() },
};
beforeEach(() => {
  window.history.replaceState(null, '', '/signup');
  hook.mockReturnValue(base);
});
it('does not offer creation before email verification', () => {
  render(<Signup />);
  expect(screen.getByRole('button', { name: 'com_signup_send' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'com_signup_create' })).not.toBeInTheDocument();
});
it('requires an explicit verification action and removes the token from the URL', async () => {
  window.history.replaceState(null, '', '/signup#token=synthetic-secret');
  render(<Signup />);
  expect(window.location.hash).toBe('');
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'com_signup_verify' }));
  });
  expect(base.mutation.mutateAsync).toHaveBeenCalledWith({
    path: '/api/signup/verify',
    body: { token: 'synthetic-secret' },
  });
});
it.each(['provisioning', 'failed', 'active'])('shows the %s outcome', (status) => {
  hook.mockReturnValue({ ...base, status: { data: { status, origin: 'https://example.test' } } });
  render(<Signup />);
  expect(screen.getByRole(status === 'failed' ? 'alert' : 'status')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'com_signup_send' })).not.toBeInTheDocument();
});
it('disables signup when email is not configured', () => {
  hook.mockReturnValue({ ...base, config: { data: { enabled: false } } });
  render(<Signup />);
  expect(screen.getByText('com_signup_unavailable')).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
