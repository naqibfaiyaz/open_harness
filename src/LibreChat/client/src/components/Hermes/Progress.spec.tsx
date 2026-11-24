import { render, screen } from '@testing-library/react';
import { useHermesProgress } from './queries';
import HermesProgress from './Progress';

jest.mock('./queries', () => ({ useHermesProgress: jest.fn() }));
jest.mock('~/hooks', () => ({ useLocalize: () => (key: string) => key }));
const mockedProgress = useHermesProgress as jest.Mock;

it('shows running and completed tools without arguments and stops showing stale activity when idle', () => {
  mockedProgress.mockReturnValue({
    data: {
      tools: [
        { id: 'a', tool: 'web_search', status: 'running', arguments: 'private input' },
        { id: 'b', tool: 'terminal', status: 'completed' },
      ],
    },
  });
  const view = render(<HermesProgress conversation="chat-a" turn="response-a" active />);
  expect(mockedProgress).toHaveBeenLastCalledWith('chat-a', 'response-a', true);
  expect(screen.getByText('web search')).toBeInTheDocument();
  expect(screen.getByText('com_hermes_tool_running')).toBeInTheDocument();
  expect(screen.getByText('com_hermes_tool_completed')).toBeInTheDocument();
  expect(screen.queryByText('private input')).not.toBeInTheDocument();
  view.rerender(<HermesProgress conversation="chat-a" turn="response-a" active={false} />);
  expect(screen.queryByText('web search')).not.toBeInTheDocument();
  expect(mockedProgress).toHaveBeenLastCalledWith('chat-a', 'response-a', false);
});

it('handles missing events and interrupted tools without affecting chat rendering', () => {
  mockedProgress.mockReturnValue({ data: null });
  const view = render(<HermesProgress conversation="new" active />);
  expect(view.container).toBeEmptyDOMElement();
  mockedProgress.mockReturnValue({
    data: { tools: [{ id: 'a', tool: 'terminal', status: 'interrupted' }] },
  });
  view.rerender(<HermesProgress conversation="chat-b" turn="response-b" active />);
  expect(screen.getByText('com_hermes_tool_interrupted')).toBeInTheDocument();
  expect(mockedProgress).toHaveBeenLastCalledWith('chat-b', 'response-b', true);
});
