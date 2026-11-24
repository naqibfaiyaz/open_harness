import { Router } from 'express';
import { request } from 'node:http';
import type { PlatformConfig, PlatformStatus, OrganizationConfig } from 'librechat-data-provider';
import type { Request, RequestHandler, Response } from 'express';
import type { IdentityUser } from '../organization/service';
import { IdentityError, OrganizationService } from '../organization/service';

export interface ControlClient {
  call<T>(path: string, method?: string, body?: object): Promise<T>;
}
export function createControlClient(config: PlatformConfig, secret: string): ControlClient {
  return {
    call<T>(path: string, method = 'GET', body?: object): Promise<T> {
      return new Promise((resolve, reject) => {
        const req = request(
          {
            socketPath: config.socketPath,
            path,
            method,
            timeout: config.timeoutMs,
            headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
          },
          (res) => {
            const chunks: Buffer[] = [];
            let length = 0;
            res.on('data', (chunk: Buffer) => {
              length += chunk.length;
              if (length > 2_000_000) res.destroy();
              else chunks.push(chunk);
            });
            res.on('error', reject);
            res.on('end', () => {
              if (!res.statusCode || res.statusCode >= 400) {
                reject(
                  new IdentityError(
                    res.statusCode === 409 ? 'PLATFORM_CONFLICT' : 'PLATFORM_REQUEST_FAILED',
                    res.statusCode ?? 503,
                  ),
                );
                return;
              }
              try {
                resolve(JSON.parse(Buffer.concat(chunks).toString()) as T);
              } catch {
                reject(new IdentityError('PLATFORM_UNAVAILABLE', 503));
              }
            });
          },
        );
        req.on('timeout', () => req.destroy(new IdentityError('PLATFORM_UNAVAILABLE', 503)));
        req.on('error', reject);
        req.end(body === undefined ? undefined : JSON.stringify(body));
      });
    },
  };
}
export async function platformAccess(
  user: IdentityUser | undefined,
  config: PlatformConfig,
  organization: OrganizationService,
): Promise<PlatformStatus> {
  const result = { enabled: config.enabled, canManage: false, recovery: false, needsMfa: false };
  if (!config.enabled || !user) return result;
  if (!user.openidId && config.bootstrapUserIds.includes(String(user.id ?? user._id)))
    return { ...result, canManage: true, recovery: true };
  if (!user.openidId || user.openidIssuer !== organization.config.issuer) return result;
  const identity = await organization.authorize(user);
  if (
    !identity.subject ||
    !(await organization.roles(identity.subject)).some((r) => r.name === 'platform-admin')
  )
    return result;
  const credentials = await organization.call<{ type: string }[]>(
    `/users/${encodeURIComponent(identity.subject)}/credentials`,
  );
  const needsMfa =
    config.requireMfa &&
    !credentials.some(
      (credential) => credential.type === 'otp' || credential.type.startsWith('webauthn'),
    );
  return { ...result, needsMfa, canManage: !needsMfa };
}
export function createPlatformRouter(deps: {
  config?: PlatformConfig;
  organization?: OrganizationConfig;
  organizationSecret: string;
  controlSecret: string;
  origin: string;
  authenticate: RequestHandler;
  control?: ControlClient;
  identityFetch?: typeof fetch;
}): Router {
  const router = Router();
  const config = deps.config;
  const identity = deps.organization
    ? new OrganizationService(deps.organization, deps.organizationSecret, deps.identityFetch)
    : undefined;
  const control = config?.enabled
    ? (deps.control ?? createControlClient(config, deps.controlSecret))
    : undefined;
  const safe =
    (
      fn: (req: Request & { user?: IdentityUser }, res: Response) => Promise<unknown>,
    ): RequestHandler =>
    (req, res) => {
      void fn(req as Request & { user?: IdentityUser }, res).catch((cause) => {
        const error =
          cause instanceof IdentityError ? cause : new IdentityError('PLATFORM_UNAVAILABLE', 503);
        if (!res.headersSent) res.status(error.status).json({ code: error.code });
      });
    };
  router.use(deps.authenticate);
  router.get(
    '/status',
    safe(async (req, res) =>
      res.json(
        config && identity
          ? await platformAccess(req.user, config, identity)
          : { enabled: false, canManage: false, recovery: false, needsMfa: false },
      ),
    ),
  );
  router.use((req, res, next) => {
    void (async () => {
      if (
        !config?.enabled ||
        !identity ||
        !control ||
        !(await platformAccess((req as Request & { user?: IdentityUser }).user, config, identity))
          .canManage
      )
        throw new IdentityError('PLATFORM_FORBIDDEN');
      if (!['GET', 'HEAD'].includes(req.method) && req.get('origin') !== deps.origin)
        throw new IdentityError('PLATFORM_ORIGIN_REFUSED');
      next();
    })().catch((cause) => {
      const error =
        cause instanceof IdentityError ? cause : new IdentityError('PLATFORM_UNAVAILABLE', 503);
      res.status(error.status).json({ code: error.code });
    });
  });
  router.get(
    '/organizations',
    safe(async (_req, res) => res.json(await control!.call('/organizations'))),
  );
  router.get(
    '/audit',
    safe(async (_req, res) => res.json(await control!.call('/audit'))),
  );
  const actor = (req: Request & { user?: IdentityUser }) => String(req.user?.id ?? req.user?._id);
  const reason = (req: Request) => {
    if (
      typeof req.body?.reason !== 'string' ||
      req.body.reason.trim().length < 8 ||
      req.body.reason.length > 300
    )
      throw new IdentityError('PLATFORM_REASON_REQUIRED', 400);
    return req.body.reason.trim();
  };
  const slug = (req: Request) => {
    const value = String(req.params.slug ?? '');
    if (!/^[a-z][a-z0-9-]{1,22}[a-z0-9]$/.test(value))
      throw new IdentityError('PLATFORM_INVALID_INPUT', 400);
    return value;
  };
  router.post(
    '/organizations',
    safe(async (req, res) => {
      const { slug: name, name: display, ownerEmail, password } = req.body;
      if (
        typeof name !== 'string' ||
        !/^[a-z][a-z0-9-]{1,22}[a-z0-9]$/.test(name) ||
        typeof display !== 'string' ||
        display.length < 2 ||
        display.length > 80 ||
        typeof ownerEmail !== 'string' ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail) ||
        ownerEmail.length > 254 ||
        typeof password !== 'string' ||
        password.length < 12 ||
        password.length > 128
      )
        throw new IdentityError('PLATFORM_INVALID_INPUT', 400);
      res
        .status(202)
        .json(
          await control!.call('/organizations', 'POST', {
            slug: name,
            name: display,
            ownerEmail,
            password,
            actor: actor(req),
            reason: reason(req),
          }),
        );
    }),
  );
  router.post(
    '/organizations/:slug/:action',
    safe(async (req, res) => {
      if (!['suspend', 'resume', 'retry', 'upgrade'].includes(String(req.params.action)))
        throw new IdentityError('PLATFORM_INVALID_INPUT', 400);
      res
        .status(202)
        .json(
          await control!.call(`/organizations/${slug(req)}/${req.params.action}`, 'POST', {
            actor: actor(req),
            reason: reason(req),
          }),
        );
    }),
  );
  router.get(
    '/organizations/:slug/members',
    safe(async (req, res) => res.json(await control!.call(`/organizations/${slug(req)}/members`))),
  );
  router.patch(
    '/organizations/:slug/members/:id',
    safe(async (req, res) => {
      const id = String(req.params.id);
      const { role, enabled } = req.body;
      if (
        !/^[\w-]{1,100}$/.test(id) ||
        (role !== undefined && !['owner', 'admin', 'user'].includes(role)) ||
        (enabled !== undefined && typeof enabled !== 'boolean') ||
        (role === undefined && enabled === undefined)
      )
        throw new IdentityError('PLATFORM_INVALID_INPUT', 400);
      res.json(
        await control!.call(`/organizations/${slug(req)}/members/${id}`, 'PATCH', {
          role,
          enabled,
          actor: actor(req),
          reason: reason(req),
        }),
      );
    }),
  );
  return router;
}
