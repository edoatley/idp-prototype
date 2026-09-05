import type { Request, Response, NextFunction } from 'express';

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

export function problemHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) return next(err);

  let problem: ApiProblem;
  if (err instanceof ApiProblem) {
    problem = err;
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
