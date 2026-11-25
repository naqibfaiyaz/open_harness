import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { PlatformConfig, SignupState } from 'librechat-data-provider';
import type { RequestHandler } from 'express';
import type { ControlClient } from './index';
import { IdentityError } from '../organization/service';
import { createControlClient } from './index';

export function createSignupRouter(deps: {
  config?: PlatformConfig;
  controlSecret: string;
  origin: string;
  control?: ControlClient;
}): Router {
  const router = Router();
  const config = deps.config;
  const control = config?.enabled
    ? (deps.control ?? createControlClient(config, deps.controlSecret))
    : undefined;
  const path = `${new URL(deps.origin).pathname.replace(/\/$/, '')}/api/signup`;
  const cookie = {
    httpOnly: true,
    secure: deps.origin.startsWith('https:'),
    sameSite: 'strict' as const,
    path,
    maxAge: 86400000,
  };
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    next();
  });
  router.get('/config', (_req, res) => {
    if (!control) {
      res.json({ enabled: false });
      return;
    }
    void control
      .call('/signup/config')
      .then((result) => res.json(result))
      .catch(() => res.json({ enabled: false }));
  });
  router.use(
    ['/start', '/verify', '/create'],
    rateLimit({
      windowMs: config?.signup?.windowMs ?? 600000,
      limit: config?.signup?.requestLimit ?? 60,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { code: 'SIGNUP_RATE_LIMIT' },
    }),
  );
  const handle =
    (action: string): RequestHandler =>
    (req, res) => {
      void (async () => {
        if (req.get('origin') !== deps.origin)
          throw new IdentityError('SIGNUP_ORIGIN_REFUSED', 403);
        if (!control) throw new IdentityError('SIGNUP_UNAVAILABLE', 503);
        const session: string =
          typeof req.cookies?.oh_signup === 'string' ? req.cookies.oh_signup : '';
        let body: object = { session };
        if (action === 'start') body = { email: req.body?.email };
        if (action === 'verify') body = { token: req.body?.token };
        if (action === 'create')
          body = {
            session,
            slug: req.body?.slug,
            name: req.body?.name,
            password: req.body?.password,
          };
        const result = await control.call<SignupState & { session?: string }>(
          `/signup/${action}`,
          'POST',
          body,
        );
        if (result.session) res.cookie('oh_signup', result.session, cookie);
        const { session: _secret, ...safe } = result;
        res.json(safe);
      })().catch((cause) => {
        const status = cause instanceof IdentityError ? cause.status : 503;
        const code = cause instanceof IdentityError ? cause.code : 'SIGNUP_UNAVAILABLE';
        res.status(status).json({ code });
      });
    };
  for (const action of ['start', 'verify', 'status', 'create'])
    router.post(`/${action}`, handle(action));
  return router;
}
