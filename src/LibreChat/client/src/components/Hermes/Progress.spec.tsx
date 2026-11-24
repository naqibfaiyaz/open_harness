import { render, screen } from '@testing-library/react';
import { useHermesProgress } from './queries';
import HermesProgress from './Progress';

jest.mock('./queries', () => ({ useHermesProgress: jest.fn() }));
jest.mock('~/hooks', () => ({ useLocalize: () => (key: string) => key }));
const mockedProgress = useHermesProgress as jest.Mock;

it('shows live running/completed tools without arguments and hides activity when idle', () => {
  mockedProgress.mockReturnValue({
    data: {
      active: true,
      tools: [
        { id: 'a', tool: 'web_search', status: 'running', arguments: 'private input' },
        { id: 'b', tool: 'terminal', status: 'completed' },
      ],
    },
  });
  const view = render(<HermesProgress conversation="chat-a" generation={123} active />);
  expect(mockedProgress).toHaveBeenLastCalledWith('chat-a', 123, true);
  expect(screen.getByText('web search')).toBeInTheDocument();
  expect(screen.getByText('com_hermes_tool_running')).toBeInTheDocument();
  expect(screen.getByText('com_hermes_tool_completed')).toBeInTheDocument();
  expect(screen.queryByText('private input')).not.toBeInTheDocument();
  view.rerender(<HermesProgress conversation="chat-a" generation={123} active={false} />);
  expect(screen.queryByText('web search')).not.toBeInTheDocument();
  expect(mockedProgress).toHaveBeenLastCalledWith('chat-a', 123, false);
});

it('does not show an ended run and uses a fresh query identity for the next generation', () => {
  mockedProgress.mockReturnValue({
    data: { active: false, tools: [{ id: 'a', tool: 'terminal', status: 'completed' }] },
  });
  const view = render(<HermesProgress conversation="chat-a" generation={123} active />);
  expect(view.container).toBeEmptyDOMElement();
  mockedProgress.mockReturnValue({
    data: { active: true, tools: [{ id: 'b', tool: 'terminal', status: 'running' }] },
  });
  view.rerender(<HermesProgress conversation="chat-a" generation={456} active />);
  expect(screen.getByText('com_hermes_tool_running')).toBeInTheDocument();
  expect(mockedProgress).toHaveBeenLastCalledWith('chat-a', 456, true);
});
