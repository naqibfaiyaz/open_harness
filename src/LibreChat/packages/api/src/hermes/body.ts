import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RequestHandler } from 'express';

const workspacePath = /^\/hermes-workspace(?:\/|\?|$)/i;
const rawBody = Symbol('Hermes request body');
type CapturedRequest = IncomingMessage & { [rawBody]?: Buffer };
type BodyCapture = (
  req: IncomingMessage,
  res: ServerResponse,
  buffer: Buffer,
  encoding: string,
) => void;

/** Keep original bytes before Express parses JSON or URL-encoded plugin forms. */
export function createHermesBodyCapture(enabled: boolean): BodyCapture {
  return (req, _res, buffer) => {
    if (enabled && workspacePath.test(req.url ?? '')) (req as CapturedRequest)[rawBody] = buffer;
  };
}

export function getHermesRequestBody(req: IncomingMessage): Buffer | undefined {
  return (req as CapturedRequest)[rawBody];
}

/** Hermes configuration is not a Mongo query. Preserve dotted names and JSON Schema $ keys.
 * Authentication and exact-Origin checks still run before the request reaches Hermes.
 */
export function createHermesRequestSanitizer(
  strict: RequestHandler,
  enabled: boolean,
): RequestHandler {
  return (req, res, next) => {
    if (enabled && workspacePath.test(req.path)) {
      next();
      return;
    }
    strict(req, res, next);
  };
}
