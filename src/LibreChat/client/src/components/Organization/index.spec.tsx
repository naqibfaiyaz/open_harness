import { render, screen } from '@testing-library/react';
import { useOrganization } from './queries';
import Organization from './index';

jest.mock('./queries', () => ({ useOrganization: jest.fn() }));
jest.mock('~/hooks', () => ({ useLocalize: () => (key: string) => key }));
const query = useOrganization as jest.Mock;
const base = {
  status: {
    data: {
      enabled: true,
      name: 'Example',
      role: 'user',
      accountURL: 'https://identity.example/account',
    },
  },
  members: { data: [] },
  connections: { data: [] },
  mutation: { mutateAsync: jest.fn() },
};
it('shows personal account security to Users without administration controls', () => {
  query.mockReturnValue(base);
  render(<Organization />);
  expect(screen.getByText('com_org_account')).toBeInTheDocument();
  expect(screen.queryByText('com_org_members')).not.toBeInTheDocument();
  expect(screen.queryByText('com_org_sso')).not.toBeInTheDocument();
});
it('shows member administration to Admins but reserves SSO for Owners', () => {
  query.mockReturnValue({ ...base, status: { data: { ...base.status.data, role: 'admin' } } });
  render(<Organization />);
  expect(screen.getByText('com_org_members')).toBeInTheDocument();
  expect(screen.queryByText('com_org_sso')).not.toBeInTheDocument();
});
it('shows SSO and recovery enrollment to the bootstrap Owner', () => {
  query.mockReturnValue({
    ...base,
    status: { data: { ...base.status.data, role: 'owner', bootstrap: true } },
  });
  render(<Organization />);
  expect(screen.getByText('com_org_sso')).toBeInTheDocument();
  expect(screen.getByText('com_org_connect_help')).toBeInTheDocument();
});
it('renders loading and unavailable states', () => {
  query.mockReturnValue({ ...base, status: { isLoading: true } });
  const view = render(<Organization />);
  expect(screen.getByRole('status')).toHaveTextContent('com_org_loading');
  query.mockReturnValue({ ...base, status: { isError: true } });
  view.rerender(<Organization />);
  expect(screen.getByRole('alert')).toHaveTextContent('com_org_error');
});
