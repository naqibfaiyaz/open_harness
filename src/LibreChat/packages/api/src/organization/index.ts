import { Router } from 'express';
import type {
  OrganizationConfig,
  OrganizationConnection,
  OrganizationRole,
} from 'librechat-data-provider';
import type { Request, RequestHandler, Response } from 'express';
import type { IdentityUser } from './service';
import { IdentityError, OrganizationService } from './service';

type OrgUser = IdentityUser & { organizationRole?: OrganizationRole };
type OrgRequest = Request & { user?: OrgUser };
interface GateDependencies {
  getConfig(): Promise<OrganizationConfig | undefined>;
  secret: string;
}

export function organizationUserLoader(deps: {
  config?: OrganizationConfig;
  secret: string;
  loadUser(id: string): Promise<OrgUser | undefined>;
}): (id: string) => Promise<OrgUser | undefined> {
  const service = deps.config?.enabled
    ? new OrganizationService(deps.config, deps.secret)
    : undefined;
  return async (id: string): Promise<OrgUser | undefined> => {
    const user = await deps.loadUser(id);
    if (!service) return user;
    try {
      const identity = await service.authorize(user);
      return user ? { ...user, organizationRole: identity.role } : undefined;
    } catch {
      return undefined;
    }
  };
}

export function withOrganizationAuth(
  authenticate: RequestHandler,
  deps: GateDependencies,
): RequestHandler {
  let service: OrganizationService | undefined;
  return (req, res, next) =>
    authenticate(req, res, (error) => {
      if (error) return next(error);
      void (async () => {
        const config = await deps.getConfig();
        if (!config?.enabled) return next();
        service ??= new OrganizationService(config, deps.secret);
        const user = (req as OrgRequest).user;
        const identity = await service.authorize(user);
        if (user) user.organizationRole = identity.role;
        next();
      })().catch((cause) => respond(res, cause));
    });
}
function respond(res: Response, cause: unknown) {
  const error = cause instanceof IdentityError ? cause : new IdentityError('ORG_UNAVAILABLE', 503);
  res.status(error.status).json({ code: error.code, message: error.code });
}
export function createOrganizationRouter(deps: {
  config?: OrganizationConfig;
  secret: string;
  authenticate: RequestHandler;
  origin: string;
  linkIdentity(id: string, subject: string, issuer: string): Promise<void>;
  request?: typeof fetch;
  platformOperatorIds?: string[];
}): Router {
  const router = Router();
  const config = deps.config;
  const service = config?.enabled
    ? new OrganizationService(config, deps.secret, deps.request)
    : undefined;
  router.use(deps.authenticate);
  router.get('/', (req, res) => {
    if (!service) {
      res.json({ enabled: false, name: '' });
      return;
    }
    void service
      .authorize((req as OrgRequest).user)
      .then((identity) =>
        res.json({
          enabled: true,
          name: config!.name,
          role: identity.role,
          bootstrap: identity.bootstrap,
          accountURL: `${config!.issuer}/account`,
        }),
      )
      .catch((cause) => respond(res, cause));
  });
  router.use((req, res, next) => {
    if (!service) {
      res.status(404).json({ code: 'ORG_DISABLED' });
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method) && req.get('origin') !== deps.origin) {
      res.status(403).json({ code: 'ORG_ORIGIN_REFUSED' });
      return;
    }
    next();
  });
  // Serialize membership writes within this single-process pilot to preserve owner invariants.
  let writes = Promise.resolve();
  const action =
    (
      fn: (
        req: OrgRequest,
        res: Response,
        actor: Awaited<ReturnType<OrganizationService['authorize']>>,
      ) => Promise<unknown>,
    ): RequestHandler =>
    (req, res) => {
      const run = async () => {
        const actor = await service!.authorize((req as OrgRequest).user);
        if (actor.role === 'user') throw new IdentityError('ORG_FORBIDDEN');
        await fn(req as OrgRequest, res, actor);
      };
      if (req.method === 'GET') void run().catch((cause) => respond(res, cause));
      else {
        const pending = writes.then(run);
        writes = pending.then(
          () => undefined,
          () => undefined,
        );
        void pending.catch((cause) => respond(res, cause));
      }
    };
  router.get(
    '/members',
    action(async (_req, res) => res.json(await service!.members())),
  );
  router.post(
    '/members',
    action(async (req, res, actor) => {
      const { email, password, role } = req.body;
      if (
        typeof email !== 'string' ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        email.length > 254 ||
        typeof password !== 'string' ||
        password.length < 12 ||
        password.length > 256 ||
        !['admin', 'user'].includes(role)
      )
        throw new IdentityError('ORG_INVALID_INPUT', 400);
      if (actor.role !== 'owner' && role !== 'user') throw new IdentityError('ORG_FORBIDDEN');
      await service!.create(email.trim().toLowerCase(), password, role);
      res.status(204).end();
    }),
  );
  router.patch(
    '/members/:id',
    action(async (req, res, actor) => {
      const { role, enabled } = req.body;
      if (
        (enabled !== undefined && typeof enabled !== 'boolean') ||
        (role !== undefined && !['user', 'admin', 'owner'].includes(role))
      )
        throw new IdentityError('ORG_INVALID_INPUT', 400);
      const target = (await service!.members()).find((m) => m.id === req.params.id);
      if (!target) throw new IdentityError('ORG_NOT_FOUND', 404);
      if (
        target.id === actor.subject ||
        target.role === 'owner' ||
        (actor.role !== 'owner' && target.role !== 'user')
      )
        throw new IdentityError('ORG_FORBIDDEN');
      if (role !== undefined) {
        if (actor.role !== 'owner' || !['user', 'admin', 'owner'].includes(role))
          throw new IdentityError('ORG_FORBIDDEN');
        await service!.assign(target.id, role);
      }
      if (enabled !== undefined) {
        await service!.call(`/users/${encodeURIComponent(target.id)}`, 'PUT', { enabled });
        if (!enabled) await service!.call(`/users/${encodeURIComponent(target.id)}/logout`, 'POST');
      }
      res.status(204).end();
    }),
  );
  router.post(
    '/identity',
    action(async (req, res, actor) => {
      if (
        !actor.bootstrap ||
        typeof req.user?.email !== 'string' ||
        typeof req.body.password !== 'string' ||
        req.body.password.length < 12 ||
        req.body.password.length > 256
      )
        throw new IdentityError('ORG_INVALID_INPUT', 400);
      const subject = await service!.create(req.user.email, req.body.password, 'owner', false);
      try {
        if (deps.platformOperatorIds?.includes(String(req.user.id ?? req.user._id))) {
          const role = await service!.call<{ id: string; name: string }>('/roles/platform-admin');
          await service!.call(`/users/${encodeURIComponent(subject)}/role-mappings/realm`, 'POST', [role]);
          await service!.call(`/users/${encodeURIComponent(subject)}`, 'PUT', { requiredActions: ['CONFIGURE_TOTP'] });
        }
        await deps.linkIdentity(String(req.user.id ?? req.user._id), subject, config!.issuer);
      } catch (cause) {
        await service!.call(`/users/${encodeURIComponent(subject)}`, 'DELETE');
        throw cause;
      }
      res.status(204).end();
    }),
  );
  router.get(
    '/connections',
    action(async (_req, res, actor) => {
      if (actor.role !== 'owner') throw new IdentityError('ORG_FORBIDDEN');
      const providers = await service!.call<OrganizationConnection[]>(
        '/identity-provider/instances',
      );
      res.json(providers.map(({ alias, providerId, enabled }) => ({ alias, providerId, enabled })));
    }),
  );
  router.post(
    '/connections',
    action(async (req, res, actor) => {
      if (actor.role !== 'owner') throw new IdentityError('ORG_FORBIDDEN');
      const { alias, providerId, config: settings } = req.body;
      if (
        typeof alias !== 'string' ||
        !/^[a-z0-9-]{1,50}$/.test(alias) ||
        !['oidc', 'saml'].includes(providerId) ||
        !settings ||
        typeof settings !== 'object' ||
        Array.isArray(settings) ||
        Object.values(settings).some((v) => typeof v !== 'string')
      )
        throw new IdentityError('ORG_INVALID_INPUT', 400);
      const urls =
        providerId === 'oidc'
          ? ['authorizationUrl', 'tokenUrl', 'jwksUrl']
          : ['singleSignOnServiceUrl'];
      for (const field of urls) {
        try {
          if (new URL(settings[field]).protocol !== 'https:') throw new Error();
        } catch {
          throw new IdentityError('ORG_INVALID_INPUT', 400);
        }
      }
      if (providerId === 'saml' && !settings.signingCertificate)
        throw new IdentityError('ORG_INVALID_INPUT', 400);
      await service!.call('/identity-provider/instances', 'POST', {
        alias,
        providerId,
        enabled: true,
        trustEmail: false,
        storeToken: false,
        config: {
          ...settings,
          syncMode: 'IMPORT',
          validateSignature: 'true',
          ...(providerId === 'oidc' ? { useJwksUrl: 'true' } : { wantAssertionsSigned: 'true' }),
        },
      });
      res.status(204).end();
    }),
  );
  router.delete(
    '/connections/:alias',
    action(async (req, res, actor) => {
      if (actor.role !== 'owner') throw new IdentityError('ORG_FORBIDDEN');
      await service!.call(
        `/identity-provider/instances/${encodeURIComponent(String(req.params.alias))}`,
        'DELETE',
      );
      res.status(204).end();
    }),
  );
  return router;
}
