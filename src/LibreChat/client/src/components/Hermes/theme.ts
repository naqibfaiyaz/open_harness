import theme from './librechatTheme.json';

/** Additive theme bridge. Never replaces Hermes markup, stylesheets or event handlers. */
export function extendHermesTheme(
  target: Document,
  host: Document,
  workspaceLabel?: string,
): () => void {
  const style = target.createElement('style');
  style.dataset.librechatHermesTheme = '';
  const fonts: string[] = [];
  for (const sheet of Array.from(host.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) {
        if (rule.type !== 5) continue;
        const font = rule as CSSFontFaceRule;
        if (!font.style.getPropertyValue('font-family').includes('Inter')) continue;
        fonts.push(
          font.cssText.replace(
            /url\(["']?([^"')]+)["']?\)/gu,
            (_match, path: string) => `url("${new URL(path, sheet.href || host.baseURI).href}")`,
          ),
        );
      }
    } catch {
      // A third-party stylesheet can restrict CSSOM access; system fonts remain usable.
    }
  }
  style.textContent = `${fonts.join('\n')}\n${theme.customCSS}`;
  target.head.append(style);
  const originalTitle = target.title;
  const renamed = new Map<Text, string>();
  const brand = () => {
    if (!workspaceLabel) return;
    target.title = workspaceLabel;
    for (const header of Array.from(target.querySelectorAll('header'))) {
      const walker = target.createTreeWalker(header, 4);
      let node = walker.nextNode();
      while (node) {
        if (/^\s*Hermes(?: Agent)?\s*$/.test(node.textContent ?? '')) {
          const text = node as Text;
          if (!renamed.has(text)) renamed.set(text, text.data);
          text.data = workspaceLabel;
        }
        node = walker.nextNode();
      }
    }
  };
  brand();
  const branding = new MutationObserver(brand);
  if (workspaceLabel)
    branding.observe(target.body, { childList: true, subtree: true, characterData: true });
  const root = target.documentElement;
  const names: Record<string, string> = {
    canvas: 'surface-primary',
    panel: 'surface-sidebar',
    control: 'surface-secondary',
    hover: 'surface-tertiary',
    text: 'text-primary',
    muted: 'text-secondary',
    border: 'border-medium',
  };
  const update = () => {
    const view = host.defaultView;
    if (!view) return;
    const computed = view.getComputedStyle(host.documentElement);
    for (const [name, token] of Object.entries(names)) {
      const value = computed.getPropertyValue(`--${token}`).trim();
      if (value) root.style.setProperty(`--lc-hermes-${name}`, `rgb(${value})`);
    }
    root.style.setProperty('--lc-hermes-font', view.getComputedStyle(host.body).fontFamily);
    root.style.colorScheme = computed.colorScheme;
  };
  update();
  const observer = new MutationObserver(update);
  observer.observe(host.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'style', 'data-theme'],
  });
  return () => {
    observer.disconnect();
    branding.disconnect();
    for (const [node, original] of renamed) {
      if (node.data === workspaceLabel) node.data = original;
    }
    if (workspaceLabel && target.title === workspaceLabel) target.title = originalTitle;
    style.remove();
    for (const name of [...Object.keys(names), 'font'])
      root.style.removeProperty(`--lc-hermes-${name}`);
    root.style.removeProperty('color-scheme');
  };
}
