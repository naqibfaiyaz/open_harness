import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import type {
  OrganizationConfig,
  OrganizationApiConfig,
  OrganizationApiKey,
  OrganizationApiKeyStore,
} from 'librechat-data-provider';
import type { Request, Response, RequestHandler } from 'express';
import type { HermesUser } from '../hermes/config';
import { OrganizationService, IdentityError } from './service';

export const organizationKeyDigest = (key: string): string =>
  createHash('sha256').update(`open-harness-org-key-v1:${key}`).digest('hex');
interface Catalog {
  object: 'list';
  data: { id: string; object: 'model'; owned_by: string; created: number }[];
}
interface Context {
  key: OrganizationApiKey;
  hash: string;
}
const invalid = (code: string, status = 400) => new IdentityError(code, status);
const openAIError = (res: Response, status: number, code: string) =>
  res.status(status).json({
    error: {
      message: code,
      type: status === 401 ? 'authentication_error' : 'invalid_request_error',
      param: null,
      code,
    },
  });

export function createOrganizationKeyIntegration(deps: {
  config?: OrganizationApiConfig;
  organization?: OrganizationConfig;
  secret: string;
  bridgeKey: string;
  origin: string;
  store: OrganizationApiKeyStore;
  authenticate: RequestHandler;
  loadUser: (id: string) => Promise<HermesUser | undefined>;
  catalog: () => Promise<Catalog>;
  executor: RequestHandler;
  identityFetch?: typeof fetch;
}): { management: Router; api: Router } {
  const management = Router();
  const api = Router();
  const config = deps.config;
  const organization = deps.organization;
  const identity = organization?.enabled
    ? new OrganizationService(organization, deps.secret, deps.identityFetch)
    : undefined;
  const enabled = !!(config?.enabled && identity && organization);
  const context = new WeakMap<Request, Context>();
  const running = new Map<string, Set<Response>>();
  let writes = Promise.resolve();
  const safe =
    (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
    (req, res) => {
      void fn(req, res).catch((cause) => {
        if (res.headersSent) {
          res.destroy();
          return;
        }
        const error = cause instanceof IdentityError ? cause : invalid('ORG_API_UNAVAILABLE', 503);
        res.status(error.status).json({ code: error.code });
      });
    };
  management.use(deps.authenticate);
  management.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  management.use((req, res, next) => {
    void (async () => {
      if (!enabled) throw invalid('ORG_API_DISABLED', 404);
      if (!['GET', 'HEAD'].includes(req.method) && req.get('origin') !== deps.origin)
        throw invalid('ORG_ORIGIN_REFUSED', 403);
      const user = (req as Request & { user?: HermesUser }).user;
      const actor = await identity!.authorize(user);
      if (actor.role === 'user') throw invalid('ORG_FORBIDDEN', 403);
      next();
    })().catch((cause) => {
      const error = cause instanceof IdentityError ? cause : invalid('ORG_API_UNAVAILABLE', 503);
      res.status(error.status).json({ code: error.code });
    });
  });
  management.get(
    '/',
    safe(async (_req, res) =>
      res.json({
        enabled: true,
        baseURL: `${deps.origin}/api/agents/v1`,
        defaultExpiryDays: Math.min(config!.defaultExpiryDays, config!.maxExpiryDays),
        maxExpiryDays: config!.maxExpiryDays,
        keys: await deps.store.list(organization!.issuer),
      }),
    ),
  );
  const serial =
    (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
    (req, res) => {
      const pending = writes.then(async () => {
        const actor = await identity!.authorize((req as Request & { user?: HermesUser }).user);
        if (actor.role === 'user') throw invalid('ORG_FORBIDDEN', 403);
        await fn(req, res);
      });
      writes = pending.then(
        () => undefined,
        () => undefined,
      );
      void pending.catch((cause) => {
        const error = cause instanceof IdentityError ? cause : invalid('ORG_API_UNAVAILABLE', 503);
        if (!res.headersSent) res.status(error.status).json({ code: error.code });
      });
    };
  management.post(
    '/',
    serial(async (req, res) => {
      const { name, expiryDays, allowedModels } = req.body ?? {};
      if (
        typeof name !== 'string' ||
        !name.trim() ||
        name.length > 80 ||
        !Number.isInteger(expiryDays) ||
        expiryDays < 1 ||
        expiryDays > config!.maxExpiryDays ||
        !Array.isArray(allowedModels) ||
        allowedModels.length > 50 ||
        !allowedModels.every(
          (model) => typeof model === 'string' && /^(Agent|Model): .{1,250}$/.test(model),
        )
      )
        throw invalid('ORG_API_INVALID_INPUT');
      if ((await deps.store.countActive(organization!.issuer)) >= config!.maxKeys)
        throw invalid('ORG_API_KEY_LIMIT', 409);
      const actor = (req as Request & { user?: HermesUser }).user;
      const createdBy = String(actor?.id ?? actor?._id ?? '');
      if (!createdBy) throw invalid('ORG_FORBIDDEN', 403);
      const secret = `oh_org_${randomBytes(32).toString('hex')}`;
      const key: OrganizationApiKey = {
        id: randomUUID(),
        issuer: organization!.issuer,
        name: name.trim(),
        prefix: secret.slice(0, 18),
        createdBy,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + expiryDays * 86400000).toISOString(),
        allowedModels: [...new Set<string>(allowedModels)],
      };
      await deps.store.create({ ...key, keyHash: organizationKeyDigest(secret) });
      res.status(201).json({ key, secret });
    }),
  );
  management.delete(
    '/:id',
    serial(async (req, res) => {
      const id = String(req.params.id);
      if (!/^[a-f0-9-]{36}$/.test(id)) throw invalid('ORG_API_INVALID_INPUT');
      const actor = (req as Request & { user?: HermesUser }).user;
      if (!(await deps.store.revoke(id, organization!.issuer, String(actor?.id ?? actor?._id))))
        throw invalid('ORG_API_KEY_NOT_FOUND', 404);
      for (const response of running.get(id) ?? []) response.destroy();
      res.status(204).end();
    }),
  );

  api.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.removeHeader('Access-Control-Allow-Origin');
    next();
  });
  api.use(
    rateLimit({
      windowMs: 60000,
      limit: config?.authRequestsPerMinute ?? 300,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: (_req, res) => {
        openAIError(res, 429, 'rate_limit_exceeded');
      },
    }),
  );
  api.use((req, res, next) => {
    void (async () => {
      if (!enabled) return openAIError(res, 404, 'api_disabled');
      const origin = req.get('origin');
      if (origin && !config!.allowedOrigins.includes(origin))
        return openAIError(res, 403, 'origin_not_allowed');
      if (origin) {
        res.set('Access-Control-Allow-Origin', origin);
        res.vary('Origin');
      }
      const token = /^Bearer (oh_org_[a-f0-9]{64})$/i.exec(req.get('authorization') ?? '')?.[1];
      if (!token) return openAIError(res, 401, 'invalid_api_key');
      const hash = organizationKeyDigest(token);
      const key = await deps.store.find(hash, organization!.issuer);
      if (!key) return openAIError(res, 401, 'invalid_api_key');
      const user = await deps.loadUser(key.createdBy);
      if (!user || !['owner', 'admin'].includes(user.organizationRole ?? ''))
        return openAIError(res, 401, 'account_access_revoked');
      context.set(req, { key, hash });
      await deps.store.touch(key.id, organization!.issuer);
      next();
    })().catch(() => {
      if (!res.headersSent) openAIError(res, 503, 'api_unavailable');
      else res.destroy();
    });
  });
  api.use(
    rateLimit({
      windowMs: 60000,
      limit: config?.requestsPerMinute ?? 60,
      keyGenerator: (req) => context.get(req)!.key.id,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: (_req, res) => {
        openAIError(res, 429, 'rate_limit_exceeded');
      },
    }),
  );
  api.get('/models', (req, res) => {
    const key = context.get(req)!.key;
    void deps
      .catalog()
      .then((catalog) =>
        res.json({
          ...catalog,
          data: catalog.data.filter(
            (model) => !key.allowedModels.length || key.allowedModels.includes(model.id),
          ),
        }),
      )
      .catch(() => {
        openAIError(res, 503, 'models_unavailable');
      });
  });
  api.post('/chat/completions', (req, res, next) => {
    const ctx = context.get(req)!;
    const { key, hash } = ctx;
    const model = req.body?.model;
    if (
      typeof model !== 'string' ||
      !/^(Agent|Model): .{1,250}$/.test(model) ||
      (key.allowedModels.length && !key.allowedModels.includes(model))
    ) {
      openAIError(res, 403, 'model_not_allowed');
      return;
    }
    const conversation = req.get('x-conversation-id') || randomUUID();
    if (!/^[\w.-]{1,128}$/.test(conversation)) {
      openAIError(res, 400, 'invalid_conversation_id');
      return;
    }
    const active = running.get(key.id) ?? new Set<Response>();
    const organizationRuns = [...running.values()].reduce(
      (total, responses) => total + responses.size,
      0,
    );
    if (
      active.size >= (config?.maxConcurrent ?? 2) ||
      organizationRuns >= (config?.maxOrgConcurrent ?? 4)
    ) {
      openAIError(res, 429, 'concurrency_limit_exceeded');
      return;
    }
    active.add(res);
    running.set(key.id, active);
    const release = () => {
      clearInterval(recheck);
      active.delete(res);
      if (!active.size) running.delete(key.id);
    };
    const recheck = setInterval(() => {
      void Promise.all([deps.store.find(hash, organization!.issuer), deps.loadUser(key.createdBy)])
        .then(([current, user]) => {
          if (!current || !user || !['owner', 'admin'].includes(user.organizationRole ?? ''))
            res.destroy();
        })
        .catch(() => res.destroy());
    }, config?.recheckMs ?? 15000);
    recheck.unref();
    res.once('close', release);
    res.set('X-Conversation-Id', conversation);
    req.headers.authorization = `Bearer ${deps.bridgeKey}`;
    req.headers['x-librechat-user-id'] = key.createdBy;
    req.headers['x-librechat-conversation-id'] = `external-${createHmac('sha256', deps.bridgeKey)
      .update(JSON.stringify([organization!.issuer, key.id, conversation]))
      .digest('hex')}`;
    req.headers['x-librechat-response-id'] = randomUUID();
    delete req.headers['x-librechat-message-id'];
    deps.executor(req, res, next);
  });
  api.use((_req, res) => {
    openAIError(res, 404, 'unsupported_endpoint');
  });
  return { management, api };
}
