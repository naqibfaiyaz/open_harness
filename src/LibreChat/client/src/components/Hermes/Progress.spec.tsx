import { render, screen } from '@testing-library/react';
import type { TMessage } from 'librechat-data-provider';
import { hermesProgressTurn } from './progressTurn';
import { useHermesProgress } from './queries';
import HermesProgress from './Progress';

jest.mock('./queries', () => ({ useHermesProgress: jest.fn() }));
jest.mock('~/hooks', () => ({ useLocalize: () => (key: string) => key }));
const mockedProgress = useHermesProgress as jest.Mock;

it('follows the allocated assistant ID without selecting another turn or stale branch', () => {
  const submission = {
    userMessage: { messageId: 'user-1' },
    initialResponse: { parentMessageId: 'user-1' },
  };
  expect(hermesProgressTurn(null, undefined)).toBeUndefined();
  expect(hermesProgressTurn([], submission)).toBeUndefined();
  const messages = [
    { messageId: 'previous-response', parentMessageId: 'previous-user', isCreatedByUser: false },
    { messageId: 'user-1', isCreatedByUser: true },
    { messageId: 'user-1_', parentMessageId: 'user-1', isCreatedByUser: false },
  ] as TMessage[];
  expect(hermesProgressTurn(messages, submission)).toBe('user-1_');
  messages[2] = { ...messages[2], messageId: 'allocated-assistant-response' };
  expect(hermesProgressTurn(messages, submission)).toBe('allocated-assistant-response');
  expect(
    hermesProgressTurn(messages, { userMessage: { messageId: 'another-user' } }),
  ).toBeUndefined();
});

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
