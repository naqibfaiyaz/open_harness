import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import HermesWorkspace from './HermesWorkspace';
import HermesNavigation from './HermesNavigation';

const mockRenew = jest.fn();
const mockPublish = jest.fn();
const mockRefetch = jest.fn();
let mockStatus: Record<string, unknown>;
let mockSession: Record<string, unknown>;
let mockPublication: Record<string, unknown>;

jest.mock('~/hooks', () => ({ useLocalize: () => (key: string) => key }));
jest.mock('@librechat/client', () => ({
  Button: ({
    children,
    variant: _variant,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) => (
    <button {...props}>{children}</button>
  ),
}));
jest.mock('./queries', () => ({
  useHermesStatus: () => mockStatus,
  useHermesSession: () => mockSession,
  useHermesProfiles: () => ({
    data: { profiles: [{ name: 'default' }, { name: 'research' }] },
    refetch: mockRefetch,
  }),
  usePublishHermesProfile: () => mockPublication,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockRenew.mockResolvedValue({ workspacePath: '/hermes-workspace', renewAfterMs: 45_000 });
  mockStatus = {
    data: { enabled: true, canManage: true, workspacePath: '/hermes-workspace' },
    refetch: mockRefetch,
  };
  mockSession = { mutateAsync: mockRenew, isError: false };
  mockPublication = { mutate: mockPublish, isLoading: false };
});

function workspace(path = '/hermes') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <HermesWorkspace />
      <HermesNavigation />
    </MemoryRouter>,
  );
}

it('keeps unauthorized users outside the workspace and does not mint a grant', () => {
  mockStatus = { data: { enabled: true, canManage: false } };
  workspace();
  expect(screen.getByText('com_hermes_forbidden')).toBeInTheDocument();
  expect(screen.queryByTitle('com_hermes_workspace')).not.toBeInTheDocument();
  expect(mockRenew).not.toHaveBeenCalled();
});

it('waits for the authenticated grant before mounting the Hermes UI', async () => {
  let resolve!: (value: unknown) => void;
  mockRenew.mockReturnValue(
    new Promise((complete) => {
      resolve = complete;
    }),
  );
  workspace('/hermes?section=%2Fmodels');
  expect(screen.queryByTitle('com_hermes_workspace')).not.toBeInTheDocument();
  resolve({ workspacePath: '/hermes-workspace', renewAfterMs: 45_000 });
  const frame = await screen.findByTitle('com_hermes_workspace');
  expect(frame).toHaveAttribute('src', '/hermes-workspace/models?profile=default');
});

it('switches Hermes profiles and publishes the selected profile', async () => {
  workspace();
  await screen.findByTitle('com_hermes_workspace');
  expect(document.querySelector('header')).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'research' } });
  expect(screen.getByTitle('com_hermes_workspace')).toHaveAttribute(
    'src',
    '/hermes-workspace/profiles?profile=research',
  );
  fireEvent.click(screen.getByText('com_hermes_publish'));
  expect(mockPublish).toHaveBeenCalledWith('research');
  fireEvent.click(screen.getByRole('link', { name: 'com_hermes_mcp' }));
  expect(screen.getByTitle('com_hermes_workspace')).toHaveAttribute(
    'src',
    '/hermes-workspace/mcp?profile=research',
  );
});

it('offers a retry when Hermes authentication fails and recovers the workspace', async () => {
  mockSession.isError = true;
  mockRenew.mockRejectedValueOnce(new Error('sanitized failure'));
  workspace();
  await waitFor(() => expect(mockRenew).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('alert')).toHaveTextContent('com_hermes_unavailable');
  fireEvent.click(screen.getByText('com_ui_retry'));
  await screen.findByTitle('com_hermes_workspace');
  expect(mockRenew).toHaveBeenCalledTimes(2);
});

it('reports that a profile needs a gateway reload rather than claiming it is ready', async () => {
  mockPublication.data = { profile: 'research', ready: false };
  workspace();
  await screen.findByTitle('com_hermes_workspace');
  expect(screen.getByText('com_hermes_restart')).toBeInTheDocument();
  expect(screen.queryByText('com_hermes_published')).not.toBeInTheDocument();
});

it('renders a recoverable status error', () => {
  mockStatus = { isError: true, refetch: mockRefetch };
  workspace();
  fireEvent.click(screen.getByText('com_ui_retry'));
  expect(mockRefetch).toHaveBeenCalledTimes(1);
  expect(mockRenew).not.toHaveBeenCalled();
});

it('offers reconnection when the embedded dashboard returns an integration error', async () => {
  workspace();
  const frame = (await screen.findByTitle('com_hermes_workspace')) as HTMLIFrameElement;
  Object.defineProperty(frame.contentDocument, 'contentType', {
    configurable: true,
    value: 'application/json',
  });
  fireEvent.load(frame);
  expect(screen.getByRole('alert')).toHaveTextContent('com_hermes_unavailable');
  expect(screen.queryByTitle('com_hermes_workspace')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('com_ui_retry'));
  await screen.findByTitle('com_hermes_workspace');
});
