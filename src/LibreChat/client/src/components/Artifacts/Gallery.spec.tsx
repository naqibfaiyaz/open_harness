import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { useInfiniteQuery } from '@tanstack/react-query';
import Gallery from './Gallery';
jest.mock('@tanstack/react-query', () => ({ useInfiniteQuery: jest.fn() }));
jest.mock('~/hooks/AuthContext', () => ({
  useAuthContext: () => ({ token: 'fixture', user: { id: 'owner' } }),
}));
jest.mock('~/hooks', () => ({ useLocalize: () => (key: string) => key }));
it('links each artifact to its source chat, branch and viewer identity', () => {
  (useInfiniteQuery as jest.Mock).mockReturnValue({
    data: {
      pages: [
        {
          artifacts: [
            {
              id: 'counter_text/html_counter_message',
              title: 'Counter demo',
              type: 'text/html',
              content: '<button>Count</button>',
              conversationId: 'chat-a',
              messageId: 'message-a',
            },
          ],
        },
      ],
    },
  });
  render(
    <MemoryRouter>
      <Gallery />
    </MemoryRouter>,
  );
  const link = screen.getByRole('link', { name: /Counter demo/ });
  expect(link.getAttribute('href')).toBe(
    '/c/chat-a?artifact=counter_text%2Fhtml_counter_message&artifactMessage=message-a',
  );
});
it('provides empty and failed states without showing unrelated content', () => {
  (useInfiniteQuery as jest.Mock).mockReturnValue({ data: { pages: [{ artifacts: [] }] } });
  render(
    <MemoryRouter>
      <Gallery />
    </MemoryRouter>,
  );
  expect(screen.getByRole('status')).toHaveTextContent('com_gallery_empty');
});
