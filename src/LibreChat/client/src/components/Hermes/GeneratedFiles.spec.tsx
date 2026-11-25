import { render, screen } from '@testing-library/react';
import GeneratedFiles from './GeneratedFiles';
jest.mock('~/hooks', () => ({ useLocalize: () => (key: string) => key }));
jest.mock('~/Providers', () => ({ useShareContext: () => ({}) }));
jest.mock('~/components/Chat/Messages/Content/Parts/LogLink', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
it('shows imported files with native download links without treating ordinary attachments as Hermes files', () => {
  render(
    <GeneratedFiles
      attachments={
        [
          {
            file_id: 'one',
            user: 'user',
            filename: 'sales.csv',
            filepath: '/api/files/download/user/one',
            type: 'text/csv',
            hermesGenerated: true,
          },
          { file_id: 'two', filename: 'unrelated.txt', filepath: '/unrelated' },
        ] as never
      }
    />,
  );
  expect(screen.getByRole('link', { name: 'sales.csv' })).toHaveAttribute(
    'href',
    '/api/files/download/user/one',
  );
  expect(screen.queryByText('unrelated.txt')).not.toBeInTheDocument();
});
