import path from 'node:path';
import express, { type Express } from 'express';
import * as OpenApiValidator from 'express-openapi-validator';
import { apiRouter } from './router';
import { writeRouter } from './writes';
import { problemHandler } from './problem';
import { bearerToken } from './auth';

// Mounts the JSON API onto the portal's Express app — one process serving both
// the human surface and the machine surface, over one implementation.
//
// The contract is enforced at runtime in BOTH directions: a malformed request is
// rejected before a handler sees it, and a response that does not match the spec
// fails loudly instead of shipping. That is what keeps contracts/openapi.yaml
// honest rather than decorative.

export function specPath(): string {
  return process.env.OPENAPI_SPEC ?? path.resolve(__dirname, '../../../contracts/openapi.yaml');
}

export function mountApi(app: Express): void {
  app.use(express.json());
  app.use(
    ...OpenApiValidator.middleware({
      apiSpec: specPath(),
      validateRequests: true,
      validateResponses: true,
      // The portal's HTML routes share this app and are deliberately not in the
      // spec; without this the validator would 404 them as undocumented.
      ignoreUndocumented: true,
      // Auth is driven by the spec: operations declaring `githubToken` require a
      // bearer, operations declaring `security: []` do not. One place decides.
      validateSecurity: {
        handlers: {
          githubToken: (req) => bearerToken(req) !== null,
        },
      },
    }),
  );

  app.use(apiRouter());
  app.use(writeRouter());
  app.use(problemHandler);
}
