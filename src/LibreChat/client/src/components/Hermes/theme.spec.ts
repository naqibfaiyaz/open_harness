import { waitFor } from '@testing-library/react';
import { extendHermesTheme } from './theme';

it('extends existing Hermes styles and follows LibreChat theme changes with cleanup', async () => {
  const target = document.implementation.createHTMLDocument('Hermes');
  const original = target.createElement('style');
  original.textContent = 'button { cursor: pointer; }';
  target.head.append(original);
  target.body.innerHTML = '<button>Save</button><pre><code>const answer = 42;</code></pre>';
  const button = target.querySelector('button');
  const clicked = jest.fn();
  button?.addEventListener('click', clicked);
  document.documentElement.style.setProperty('--surface-primary', '13 13 13');
  document.documentElement.style.setProperty('--text-primary', '236 236 236');
  const cleanup = extendHermesTheme(target, document);
  expect(target.head.contains(original)).toBe(true);
  expect(target.querySelectorAll('[data-librechat-hermes-theme]')).toHaveLength(1);
  expect(target.documentElement.style.getPropertyValue('--lc-hermes-canvas')).toBe('rgb(13 13 13)');
  button?.click();
  expect(clicked).toHaveBeenCalledTimes(1);
  expect(target.querySelector('code')?.textContent).toBe('const answer = 42;');
  document.documentElement.style.setProperty('--surface-primary', '255 255 255');
  await waitFor(() =>
    expect(target.documentElement.style.getPropertyValue('--lc-hermes-canvas')).toBe(
      'rgb(255 255 255)',
    ),
  );
  cleanup();
  expect(target.querySelectorAll('[data-librechat-hermes-theme]')).toHaveLength(0);
  expect(target.head.contains(original)).toBe(true);
  document.documentElement.style.setProperty('--surface-primary', '0 0 0');
  await Promise.resolve();
  expect(target.documentElement.style.getPropertyValue('--lc-hermes-canvas')).toBe('');
  document.documentElement.style.removeProperty('--surface-primary');
  document.documentElement.style.removeProperty('--text-primary');
});
