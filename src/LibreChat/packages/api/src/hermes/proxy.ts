import http from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';
import type { Request, Response } from 'express';
import type { Duplex } from 'node:stream';
import type { HermesConfig, HermesUser } from './config';
import type { WorkspaceSessions } from './sessions';
import type { HermesDashboard } from './dashboard';
import { HERMES_PREFIX, readWorkspaceCookie } from './sessions';
import { getHermesRequestBody } from './body';
import { canManageHermes } from './config';

export async function sendUpstream(response: globalThis.Response, res: Response): Promise<void> {
  res.status(response.status);
  for (const name of [
    'content-type',
    'content-disposition',
    'cache-control',
    'x-hermes-session-id',
    'content-range',
    'accept-ranges',
    'etag',
    'last-modified',
  ]) {
    const value = response.headers.get(name);
    if (value) res.setHeader(name, value);
  }
  res.setHeader('Cache-Control', 'no-store');
  if (!response.body) {
    res.end();
    return;
  }
  // Node and DOM declarations describe the same runtime Web Stream with different iterator types.
  const stream = Readable.fromWeb(
    response.body as unknown as import('node:stream/web').ReadableStream<Uint8Array>,
  );
  stream.on('error', () => res.destroy());
  res.once('close', () => stream.destroy());
  stream.pipe(res);
}

export function isSameOrigin(origin: string | undefined, expected: string): boolean {
  return origin === expected;
}

function dashboardPath(original: string): string {
  const path = original.slice(HERMES_PREFIX.length) || '/';
  // No normalization through URL(): dot segments must never escape the fixed proxy prefix.
  const pathname = decodeURIComponent(path.split('?')[0]);
  if (
    !path.startsWith('/') ||
    path.startsWith('//') ||
    pathname.includes('\\') ||
    pathname.split('/').some((part) => part === '..' || part === '.')
  )
    throw new Error('Invalid proxy path');
  return path;
}

/** Full stock dashboard including streaming uploads; upstream credentials stay server-side. */
export async function proxyDashboard(
  req: Request,
  res: Response,
  config: HermesConfig,
  dashboard: HermesDashboard,
): Promise<void> {
  const path = dashboardPath(req.originalUrl);
  // The bridge owns authentication. A workspace page cannot replace or revoke the service login.
  if (/^\/(?:auth|login)(?:\/|\?|$)/.test(path)) {
    res.status(403).json({ code: 'HERMES_AUTH_MANAGED_BY_LIBRECHAT' });
    return;
  }
  const headers: Record<string, string> = {
    'X-Forwarded-Prefix': HERMES_PREFIX,
    'X-Forwarded-Host': new URL(config.publicOrigin).host,
    'X-Forwarded-Proto': new URL(config.publicOrigin).protocol.slice(0, -1),
  };
  for (const name of [
    'content-type',
    'accept',
    'last-event-id',
    'x-hermes-session-token',
    'range',
    'if-range',
    'if-none-match',
    'if-modified-since',
  ]) {
    const value = req.get(name);
    if (value) headers[name] = value;
  }
  const init: RequestInit & { duplex?: string } = { method: req.method, headers };
  if (!['GET', 'HEAD'].includes(req.method)) {
    const original = getHermesRequestBody(req);
    if (original) init.body = original as unknown as BodyInit;
    else if (req.body !== undefined) init.body = JSON.stringify(req.body);
    else {
      init.body = Readable.toWeb(req) as unknown as BodyInit;
      init.duplex = 'half';
    }
  }
  const abort = new AbortController();
  req.on('aborted', () => abort.abort());
  res.once('close', () => abort.abort());
  init.signal = abort.signal;
  const response = await dashboard.fetch(path, init);
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location') ?? '';
    if (
      !location.startsWith('/') ||
      location.startsWith('//') ||
      /^\/(?:login|auth)\b/.test(location)
    ) {
      res.status(502).json({ code: 'HERMES_REAUTHENTICATION_REQUIRED' });
      return;
    }
    res.redirect(
      response.status,
      location.startsWith(`${HERMES_PREFIX}/`) ? location : `${HERMES_PREFIX}${location}`,
    );
    return;
  }
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  await sendUpstream(response, res);
}

/** Only the private, authenticated dashboard origin is an upgrade target. */
export function attachWorkspaceUpgrades(
  server: http.Server,
  config: HermesConfig,
  dashboard: HermesDashboard,
  sessions: WorkspaceSessions,
  loadUser: (id: string) => Promise<HermesUser | undefined>,
) {
  const sockets = new Set<Duplex>();
  server.on('upgrade', (req, socket, head) => {
    if (!req.url?.startsWith(`${HERMES_PREFIX}/`)) return;
    void (async () => {
      const grant = sessions.get(readWorkspaceCookie(req.headers.cookie));
      if (
        !grant ||
        !isSameOrigin(req.headers.origin, config.publicOrigin) ||
        !canManageHermes(await loadUser(grant.userId), config)
      ) {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        return;
      }
      const target = new URL(config.dashboardURL);
      const path = dashboardPath(req.url!);
      const headers = {
        ...req.headers,
        host: target.host,
        origin: target.origin,
        cookie: await dashboard.cookie(),
        'x-forwarded-prefix': HERMES_PREFIX,
        'x-forwarded-proto': new URL(config.publicOrigin).protocol.slice(0, -1),
        'x-forwarded-host': new URL(config.publicOrigin).host,
      };
      delete headers.authorization;
      const request = (target.protocol === 'https:' ? https : http).request(target, {
        method: 'GET',
        path,
        headers,
      });
      request.on('upgrade', (response, upstream, upstreamHead) => {
        const lines = ['HTTP/1.1 101 Switching Protocols'];
        for (const name of [
          'upgrade',
          'connection',
          'sec-websocket-accept',
          'sec-websocket-protocol',
        ]) {
          const value = response.headers[name];
          if (typeof value === 'string') lines.push(`${name}: ${value}`);
        }
        socket.write(`${lines.join('\r\n')}\r\n\r\n`);
        if (upstreamHead.length) socket.write(upstreamHead);
        if (head.length) upstream.write(head);
        sockets.add(socket);
        let expiry: ReturnType<typeof setTimeout>;
        const checkExpiry = () => {
          const current = sessions.get(readWorkspaceCookie(req.headers.cookie));
          if (!current) {
            socket.destroy();
            return;
          }
          expiry = setTimeout(checkExpiry, Math.max(1, current.expires - Date.now()));
        };
        checkExpiry();
        socket.on('error', () => upstream.destroy());
        upstream.on('error', () => socket.destroy());
        socket.on('close', () => {
          clearTimeout(expiry);
          sockets.delete(socket);
          upstream.destroy();
        });
        socket.pipe(upstream).pipe(socket);
      });
      request.on('response', () => socket.destroy());
      request.on('error', () => socket.destroy());
      request.setTimeout(15_000, () => request.destroy());
      request.end();
    })().catch(() => socket.destroy());
  });
  return () => {
    for (const socket of sockets) socket.destroy();
  };
}
