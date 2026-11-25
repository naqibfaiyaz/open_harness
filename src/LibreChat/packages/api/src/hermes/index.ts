import { Router } from 'express';
import { ArtifactModes } from 'librechat-data-provider';
import type { Request, Response, RequestHandler } from 'express';
import type { Server } from 'node:http';
import type { HermesConfig, HermesSecrets, HermesUser } from './config';
import {
  HERMES_COOKIE,
  HERMES_PREFIX,
  WorkspaceSessions,
  readWorkspaceCookie,
  serviceKeyMatches,
  sessionKey,
} from './sessions';
import { attachWorkspaceUpgrades, isSameOrigin, proxyDashboard, sendUpstream } from './proxy';
import { canManageHermes, validateHermesConfig } from './config';
import { reportingInstructions } from './reporting';
import { HermesDashboard } from './dashboard';
export { createHermesBodyCapture, createHermesRequestSanitizer } from './body';
import { HermesRuntime } from './runtime';
import { generatePromptTitle, HERMES_TITLE_MODEL } from './titles';
import { HermesProgress, observeHermesProgress } from './progress';
import {
  createHermesDeliveryHandler,
  deliveryDirectory,
  hermesPresentationInstructions,
} from './deliveries';
import type { HermesDeliveryStorage } from './deliveries';

interface Dependencies {
  config: HermesConfig;
  secrets: HermesSecrets;
  authenticate: RequestHandler;
  loadUser: (id: string) => Promise<HermesUser | undefined>;
  fetch?: typeof fetch;
  deliveryStorage?: HermesDeliveryStorage;
}
type UserRequest = Request & { user?: HermesUser };
const messages: Record<string, string> = {
  HERMES_PROFILE_OR_MODEL_NOT_READY:
    'This agent or model is not ready. Enable it in Agent workspace and start a new chat.',
  HERMES_EXECUTION_REQUIRED:
    'Select the Hermes endpoint. Manage agents and tools in Agent workspace.',
  HERMES_CONFIGURE_TOOLS_IN_WORKSPACE:
    'Configure tools in Agent workspace before starting a new chat.',
  HERMES_SESSION_CONTEXT_REQUIRED:
    'The LibreChat user or conversation context is missing from the server configuration.',
  HERMES_UNAVAILABLE: 'The agent service is unavailable. Retry after checking its connection.',
  HERMES_EXECUTION_FAILED:
    'The agent could not complete this request. Check the session in Agent workspace.',
};
const error = (res: Response, status: number, code: string) =>
  res
    .status(status)
    .json({ code, error: { type: 'hermes_integration_error', message: messages[code] ?? code } });
export interface HermesIntegration {
  api: Router;
  workspace: Router;
  executor: Router;
  catalog: HermesRuntime['catalog'];
  executionGuard: RequestHandler;
  attach(server: Server): () => void;
}

export function createHermesIntegration(deps: Dependencies): HermesIntegration {
  const { secrets, authenticate } = deps;
  validateHermesConfig(deps.config, secrets);
  const config = {
    ...deps.config,
    publicOrigin: new URL(deps.config.publicOrigin).origin,
    dashboardURL: new URL(deps.config.dashboardURL).origin,
    runtimeURL: new URL(deps.config.runtimeURL).origin,
  };
  const dashboard = new HermesDashboard(config, secrets, deps.fetch);
  const runtime = new HermesRuntime(config, secrets, dashboard, deps.fetch);
  const deliver = deps.deliveryStorage
    ? createHermesDeliveryHandler({
        dashboard,
        config,
        bridgeKey: secrets.bridgeKey,
        storage: deps.deliveryStorage,
      })
    : undefined;
  const sessions = new WorkspaceSessions();
  const progress = new HermesProgress({
    maxRuns: config.progressMaxRuns ?? 128,
    maxTools: config.progressMaxTools ?? 100,
    retentionMs: config.progressRetentionMs ?? 1800000,
  });
  const api = Router();
  const workspace = Router();
  const executor = Router();
  const safe =
    (fn: (req: UserRequest, res: Response) => Promise<unknown>): RequestHandler =>
    (req, res) => {
      void fn(req as UserRequest, res).catch(() => {
        if (!res.headersSent) error(res, 502, 'HERMES_UNAVAILABLE');
        else res.destroy();
      });
    };

  api.use(authenticate);
  api.get('/progress/:conversation', (req, res) => {
    const user = (req as UserRequest).user;
    const id = user?.id ?? String(user?._id ?? '');
    if (!id) {
      error(res, 401, 'HERMES_USER_UNAVAILABLE');
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json(progress.current(id, String(req.params.conversation)));
  });
  api.get('/progress/:conversation/:turn', (req, res) => {
    const user = (req as UserRequest).user;
    const id = user?.id ?? String(user?._id ?? '');
    if (!id) {
      error(res, 401, 'HERMES_USER_UNAVAILABLE');
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json(progress.get(id, String(req.params.conversation), String(req.params.turn)));
  });
  api.get('/status', (req, res) => {
    res.json({
      enabled: config.enabled,
      managedOnly: config.managedOnly,
      interactiveGraphs: !!config.interactiveGraphs,
      deliverFiles: !!config.deliverFiles,
      canManage: canManageHermes((req as UserRequest).user, config),
      workspacePath: HERMES_PREFIX,
      scope: 'shared-trusted-workspace',
    });
  });
  api.use((req, res, next) => {
    if (!canManageHermes((req as UserRequest).user, config)) {
      error(res, 403, 'HERMES_FORBIDDEN');
      return;
    }
    next();
  });
  const issueSession = safe(async (req, res) => {
    if (!canManageHermes(req.user, config)) return error(res, 403, 'HERMES_FORBIDDEN');
    if (!isSameOrigin(req.get('origin'), config.publicOrigin))
      return error(res, 403, 'HERMES_ORIGIN_REFUSED');
    const authorization = req.get('authorization') ?? '';
    if (!authorization.startsWith('Bearer ')) return error(res, 401, 'HERMES_BEARER_REQUIRED');
    await dashboard.cookie();
    const grant = sessions.issue(
      authorization.slice(7),
      String(req.user?.id ?? req.user?._id),
      readWorkspaceCookie(req.headers.cookie),
    );
    res.cookie(HERMES_COOKIE, grant, {
      httpOnly: true,
      secure: config.publicOrigin.startsWith('https:'),
      // Lax permits top-level MCP OAuth callbacks. Writes still require the exact Origin.
      sameSite: 'lax',
      path: HERMES_PREFIX,
      maxAge: 90_000,
    });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ workspacePath: HERMES_PREFIX, renewAfterMs: 45_000 });
  });
  workspace.post('/_session', authenticate, issueSession);
  workspace.delete('/_session', authenticate, (req, res) => {
    const cookie = readWorkspaceCookie(req.headers.cookie);
    if (cookie) sessions.revoke(cookie);
    res.clearCookie(HERMES_COOKIE, { path: HERMES_PREFIX });
    res.status(204).end();
  });
  api.get(
    '/profiles',
    safe(async (_req, res) => res.json({ profiles: await runtime.profiles() })),
  );
  api.post(
    '/publish',
    safe(async (req, res) => {
      if (!isSameOrigin(req.get('origin'), config.publicOrigin))
        return error(res, 403, 'HERMES_ORIGIN_REFUSED');
      if (typeof req.body?.profile !== 'string') return error(res, 400, 'HERMES_PROFILE_REQUIRED');
      return res.json(await runtime.publish(req.body.profile));
    }),
  );

  workspace.use((req, res, next) => {
    const grant = sessions.get(readWorkspaceCookie(req.headers.cookie));
    if (!grant) {
      error(res, 401, 'HERMES_WORKSPACE_SESSION_EXPIRED');
      return;
    }
    if (
      !['GET', 'HEAD'].includes(req.method) &&
      !isSameOrigin(req.get('origin'), config.publicOrigin)
    ) {
      error(res, 403, 'HERMES_ORIGIN_REFUSED');
      return;
    }
    // Re-run LibreChat auth, retirement, tenant and enrollment gates on every HTTP request.
    req.headers.authorization = `Bearer ${grant.token}`;
    authenticate(req, res, next);
  });
  workspace.use(
    safe(async (req, res) => {
      if (!canManageHermes(req.user, config)) return error(res, 403, 'HERMES_FORBIDDEN');
      await proxyDashboard(req, res, config, dashboard);
    }),
  );

  executor.use((req, res, next) => {
    if (!serviceKeyMatches(req.get('authorization'), secrets.bridgeKey)) {
      error(res, 401, 'HERMES_SERVICE_AUTH_REQUIRED');
      return;
    }
    next();
  });
  executor.get(
    '/models',
    safe(async (_req, res) => res.json(await runtime.catalog())),
  );
  executor.post(
    '/chat/completions',
    safe(async (req, res) => {
      const user = req.get('x-librechat-user-id');
      const conversation = req.get('x-librechat-conversation-id');
      if (!user || !conversation || user.includes('{{') || conversation.includes('{{')) {
        return error(res, 400, 'HERMES_SESSION_CONTEXT_REQUIRED');
      }
      if (!(await deps.loadUser(user))) return error(res, 403, 'HERMES_USER_UNAVAILABLE');
      if (typeof req.body?.model !== 'string' || !Array.isArray(req.body.messages)) {
        return error(res, 400, 'HERMES_INVALID_CHAT');
      }
      // Native LibreChat tool definitions cannot secretly create a second execution loop.
      if (req.body.tools?.length || req.body.functions?.length) {
        return error(res, 400, 'HERMES_CONFIGURE_TOOLS_IN_WORKSPACE');
      }
      if (req.body.model === HERMES_TITLE_MODEL) {
        const content = await generatePromptTitle(req.body.messages, async (prompt) => {
          const response = await dashboard.fetch('/api/plugins/open-harness-titles/generate', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Open-Harness-Key': secrets.bridgeKey,
            },
            body: JSON.stringify({ prompt }),
          });
          if (!response.ok) throw new Error('HERMES_TITLE_UNAVAILABLE');
          const payload = (await response.json()) as { title: string };
          return payload.title;
        });
        const completion = {
          id: 'hermes-title',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: HERMES_TITLE_MODEL,
          choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        };
        if (!req.body.stream) return res.json(completion);
        res.type('text/event-stream');
        res.write(
          `data: ${JSON.stringify({
            ...completion,
            object: 'chat.completion.chunk',
            choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }],
          })}\n\n`,
        );
        res.write(
          `data: ${JSON.stringify({
            ...completion,
            object: 'chat.completion.chunk',
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          })}\n\n`,
        );
        return res.end('data: [DONE]\n\n');
      }
      let target;
      try {
        target = await runtime.resolve(req.body.model);
      } catch {
        return error(res, 409, 'HERMES_PROFILE_OR_MODEL_NOT_READY');
      }
      const abort = new AbortController();
      req.once('aborted', () => abort.abort());
      res.once('close', () => abort.abort());
      // Allowlist inference fields. Never accept body-level profile/provider/API-key overrides.
      const presentation =
        config.interactiveGraphs || config.deliverFiles
          ? [
              {
                role: 'system',
                content: hermesPresentationInstructions(
                  deliveryDirectory(secrets.bridgeKey, user, conversation),
                  !!config.interactiveGraphs,
                ),
              },
            ]
          : [];
      const latestUser = req.body.messages
        .filter((message: { role?: string }) => message.role === 'user')
        .at(-1);
      let userText = '';
      if (typeof latestUser?.content === 'string') userText = latestUser.content;
      else if (Array.isArray(latestUser?.content)) {
        userText = latestUser.content
          .filter(
            (part: { type?: string; text?: string }) =>
              part.type === 'text' && typeof part.text === 'string',
          )
          .map((part: { text: string }) => part.text)
          .join('\n');
      }
      const temporal = config.reportingPeriods
        ? [
            {
              role: 'system',
              content: reportingInstructions(
                userText,
                config.reportingTimeZone ?? 'UTC',
                secrets.bridgeKey,
              ),
            },
          ]
        : [];
      const body: Record<string, unknown> = {
        model: target.model,
        messages: [...req.body.messages, ...presentation, ...temporal],
      };
      for (const key of [
        'stream',
        'temperature',
        'top_p',
        'max_tokens',
        'max_completion_tokens',
        'stop',
        'presence_penalty',
        'frequency_penalty',
        'reasoning_effort',
        'stream_options',
      ]) {
        if (req.body[key] !== undefined) body[key] = req.body[key];
      }
      const turn = req.get('x-librechat-response-id') || req.get('x-librechat-message-id');
      const activity =
        body.stream && turn && /^[\w-]{1,257}$/u.test(turn)
          ? progress.begin(user, conversation, turn)
          : undefined;
      const finish = () => activity?.finish();
      res.once('close', finish);
      let response: globalThis.Response;
      try {
        response = await (deps.fetch ?? fetch)(target.url, {
          method: 'POST',
          redirect: 'error',
          signal: abort.signal,
          headers: {
            Authorization: `Bearer ${target.key}`,
            'Content-Type': 'application/json',
            'X-Hermes-Session-Key': sessionKey(secrets.bridgeKey, user, conversation),
          },
          body: JSON.stringify(body),
        });
      } catch (cause) {
        finish();
        throw cause;
      }
      if (!response.ok) {
        finish();
        await response.body?.cancel();
        return error(res, response.status, 'HERMES_EXECUTION_FAILED');
      }
      if (
        activity &&
        response.body &&
        response.headers.get('content-type')?.includes('text/event-stream')
      ) {
        const observed = response.body.pipeThrough(observeHermesProgress(activity.event, finish));
        response = new globalThis.Response(observed, {
          status: response.status,
          headers: response.headers,
        });
      } else finish();
      await sendUpstream(response, res);
    }),
  );

  const executionGuard: RequestHandler = (req, res, next) => {
    if (!config.managedOnly || req.method !== 'POST' || req.path.endsWith('/abort')) {
      next();
      return;
    }
    const endpoint = req.body?.endpoint;
    if (
      endpoint !== config.endpointName ||
      req.body?.agent_id ||
      req.body?.endpointOption?.agent_id ||
      req.originalUrl.startsWith('/api/assistants/')
    ) {
      error(res, 403, 'HERMES_EXECUTION_REQUIRED');
      return;
    }
    // The server's custom endpoint configuration chooses the provider, never a client override.
    req.body.endpointType = 'custom';
    (req as UserRequest & { hermesDeliverOutput?: unknown }).hermesDeliverOutput = async (
      message: Parameters<NonNullable<typeof deliver>>[1],
    ) => {
      const id = (req as UserRequest).user?.id ?? String((req as UserRequest).user?._id ?? '');
      if (id && deliver) await deliver(id, message);
    };
    // Artifacts format model output; they do not run a second tool loop.
    const requestedArtifacts = req.body?.ephemeralAgent?.artifacts;
    const defaultArtifacts = config.artifactsEnabledByDefault ? ArtifactModes.SHADCNUI : '';
    const artifacts = Object.values(ArtifactModes).includes(requestedArtifacts)
      ? requestedArtifacts
      : defaultArtifacts;
    req.body.ephemeralAgent = {
      mcp: [],
      web_search: false,
      file_search: false,
      execute_code: false,
      skills: false,
      memory: false,
      ask_user_question: false,
      run_in_background: false,
      describe_intent: false,
      artifacts,
    };
    next();
  };

  return {
    api,
    workspace,
    executor,
    catalog: () => runtime.catalog(),
    executionGuard,
    attach(server: Server) {
      return attachWorkspaceUpgrades(server, config, dashboard, sessions, deps.loadUser);
    },
  };
}
