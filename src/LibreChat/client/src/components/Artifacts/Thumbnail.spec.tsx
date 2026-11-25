import { render, screen } from '@testing-library/react';
import Thumbnail from './Thumbnail';
jest.mock('~/hooks', () => ({ useLocalize: () => (key: string) => key }));
it('renders HTML without scripts, network access or sandbox permissions', () => {
  render(
    <Thumbnail
      title="Example"
      type="text/html"
      content={
        '<script>alert(1)</script><button onclick="alert(1)">Hello</button><img src="https://external.invalid/pixel">'
      }
    />,
  );
  const frame = screen.getByTitle('Example');
  expect(frame).toHaveAttribute('sandbox', '');
  const source = frame.getAttribute('srcdoc') ?? '';
  expect(source).not.toContain('<script>');
  expect(source).not.toContain('onclick');
  expect(source).toContain("default-src 'none'");
});
it('shows source thumbnails for React without executing the component', () => {
  render(
    <Thumbnail
      title="Counter"
      type="application/vnd.react"
      content={'export default function App() { return <button>Count</button>; }'}
    />,
  );
  expect(screen.getByText(/export default function App/)).toBeInTheDocument();
  expect(screen.queryByTitle('Counter')).not.toBeInTheDocument();
});
