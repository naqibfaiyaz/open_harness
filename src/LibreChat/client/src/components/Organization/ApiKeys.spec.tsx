import { act, fireEvent, render, screen } from '@testing-library/react';
import ApiKeys from './ApiKeys';
import { useOrganizationKeys } from './keyQueries';
jest.mock('./keyQueries', () => ({ useOrganizationKeys: jest.fn() }));
jest.mock('~/hooks', () => ({ useLocalize: () => (key: string) => key }));
const hook = useOrganizationKeys as jest.Mock;
const create = { mutateAsync: jest.fn(), reset: jest.fn() };
const base = {
  page: {
    data: {
      enabled: true,
      baseURL: 'https://org.test/api/agents/v1',
      keys: [],
      defaultExpiryDays: 90,
      maxExpiryDays: 365,
    },
  },
  create,
  revoke: { mutateAsync: jest.fn() },
};
beforeEach(() => {
  hook.mockReturnValue(base);
  create.mutateAsync.mockResolvedValue({ secret: 'one-time-fixture-secret' });
});
it('shows the external URL and reveals a new key only until dismissed', async () => {
  render(<ApiKeys />);
  expect(screen.getByLabelText('com_org_api_base')).toHaveValue('https://org.test/api/agents/v1');
  fireEvent.change(screen.getByLabelText('com_org_api_name'), { target: { value: 'OpenWebUI' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'com_org_api_create' }));
  });
  expect(create.mutateAsync).toHaveBeenCalledWith({
    name: 'OpenWebUI',
    expiryDays: 90,
    allowedModels: ['Agent: default'],
  });
  expect(screen.getByText('one-time-fixture-secret')).toBeInTheDocument();
  expect(create.reset).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'com_org_api_dismiss' }));
  expect(screen.queryByText('one-time-fixture-secret')).not.toBeInTheDocument();
});
it('keeps creation unavailable when settings cannot be loaded', () => {
  hook.mockReturnValue({ ...base, page: { isError: true } });
  render(<ApiKeys />);
  expect(screen.getByRole('alert')).toHaveTextContent('com_org_api_error');
  expect(screen.queryByRole('button', { name: 'com_org_api_create' })).not.toBeInTheDocument();
});
