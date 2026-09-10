import type { Request, Response, NextFunction } from 'express';
import { GitHubError, ChangeInFlightError, InventoryUnavailableError } from 'idp-core';

// Errors in the RFC 9457 `application/problem+json` shape, as the contract
// promises. One shape for every failure means a client writes one error path.

export interface FieldProblem {
  field: string;
  message: string;
}

export class ApiProblem extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    readonly detail?: string,
    readonly errors?: FieldProblem[],
    readonly type: string = 'about:blank',
  ) {
    super(detail ?? title);
    this.name = 'ApiProblem';
  }
}

export const badRequest = (detail: string, errors?: FieldProblem[]) =>
  new ApiProblem(400, 'Validation failed', detail, errors, '/problems/validation-failed');
export const unauthorized = (detail: string) =>
  new ApiProblem(401, 'Unauthorized', detail, undefined, '/problems/unauthorized');
export const notFound = (detail: string) =>
  new ApiProblem(404, 'Not found', detail, undefined, '/problems/not-found');
export const conflict = (detail: string, type = '/problems/conflict') =>
  new ApiProblem(409, 'Conflict', detail, undefined, type);
export const upstreamUnavailable = (detail: string) =>
  new ApiProblem(502, 'Upstream unavailable', detail, undefined, '/problems/upstream-unavailable');

/** express 4 does not catch rejected promises; every async handler goes through this. */
export function asyncRoute(fn: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

// express-openapi-validator raises errors carrying `status` and a list of
// `{path, message}`; translate those into the same Problem shape so a schema
// violation and a domain rejection are indistinguishable to a client.
interface ValidatorError {
  status?: number;
  message?: string;
  errors?: Array<{ path?: string; message?: string }>;
}

function fieldsFrom(err: ValidatorError): FieldProblem[] | undefined {
  if (!Array.isArray(err.errors) || err.errors.length === 0) return undefined;
  // The validator reports JSON pointers like "/body/name". Only pointers into
  // something the caller actually sent map to a field; a security rejection
  // points at the route, and naming that as a "field" would be misleading.
  const INPUTS = ['body', 'query', 'params', 'headers'];
  const fields = err.errors
    .filter((e) => INPUTS.includes((e.path ?? '').split('/').filter(Boolean)[0] ?? ''))
    .map((e) => ({
      field: (e.path ?? '').split('/').filter(Boolean).pop() ?? 'request',
      message: e.message ?? 'invalid',
    }));
  return fields.length ? fields : undefined;
}

// A response-validation failure means WE broke the contract, not the caller, so
// it surfaces as a 500 rather than blaming the request.
const TITLES: Record<number, { title: string; type: string }> = {
  400: { title: 'Validation failed', type: '/problems/validation-failed' },
  401: { title: 'Unauthorized', type: '/problems/unauthorized' },
  403: { title: 'Forbidden', type: '/problems/forbidden' },
  404: { title: 'Not found', type: '/problems/not-found' },
  409: { title: 'Conflict', type: '/problems/conflict' },
};

/**
 * Translate an upstream GitHub failure into something the caller can act on.
 *
 * The distinction that matters: a rejected credential is the CALLER's problem
 * and must say so (401/403), while GitHub being unreachable or confused is the
 * platform's problem (502). Collapsing both into 500 — which is what happened
 * before statuses were checked — tells a user with an expired token to go and
 * read our logs.
 */
function fromGitHub(err: GitHubError): ApiProblem {
  if (err.status === 401) {
    return new ApiProblem(
      401,
      'Unauthorized',
      `GitHub rejected the token (${err.githubMessage}). Check it has not expired and carries Contents + Pull requests write on the repo.`,
      undefined,
      '/problems/unauthorized',
    );
  }
  if (err.status === 403) {
    return new ApiProblem(
      403,
      'Forbidden',
      `GitHub refused the request (${err.githubMessage}). This is usually a missing repository permission or a rate limit.`,
      undefined,
      '/problems/forbidden',
    );
  }
  return new ApiProblem(
    502,
    'Upstream unavailable',
    `GitHub returned ${err.status} for ${err.method} ${err.path}: ${err.githubMessage}`,
    undefined,
    '/problems/upstream-unavailable',
  );
}

export function problemHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) return next(err);

  let problem: ApiProblem;
  if (err instanceof ApiProblem) {
    problem = err;
  } else if (err instanceof GitHubError) {
    problem = fromGitHub(err);
  } else if (err instanceof InventoryUnavailableError) {
    // The inventory is read with the PLATFORM's credential, not the caller's, so
    // a failure here is never the caller's fault — reporting it as a 401 would
    // send someone off to check a token that is working fine.
    problem = new ApiProblem(502, 'Upstream unavailable', err.message, undefined, '/problems/upstream-unavailable');
  } else if (err instanceof ChangeInFlightError) {
    // The platform's single-writer rule, raised by whichever layer noticed first.
    problem = new ApiProblem(409, 'Conflict', err.message, undefined, '/problems/request-in-flight');
  } else {
    const v = err as ValidatorError;
    const status = typeof v.status === 'number' ? v.status : 500;
    const known = TITLES[status];
    problem = new ApiProblem(
      status,
      known?.title ?? (status >= 500 ? 'Internal error' : 'Request rejected'),
      v.message ?? 'Unexpected error',
      fieldsFrom(v),
      known?.type ?? 'about:blank',
    );
  }

  res
    .status(problem.status)
    .type('application/problem+json')
    .json({
      type: problem.type,
      title: problem.title,
      status: problem.status,
      ...(problem.detail ? { detail: problem.detail } : {}),
      instance: req.originalUrl,
      ...(problem.errors ? { errors: problem.errors } : {}),
    });
}
