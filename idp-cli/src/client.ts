import type { components } from './schema';

// A typed client over the platform API. The types come from
// contracts/openapi.yaml via `npm run generate`, so the CLI cannot drift from
// the contract without failing a typecheck — the client is generated FROM the
// same document the server validates against.

export type Bucket = components['schemas']['Bucket'];
export type BucketCreate = components['schemas']['BucketCreate'];
export type BucketUpdate = components['schemas']['BucketUpdate'];
export type PlatformRequest = components['schemas']['Request'];
export type RequestStatus = components['schemas']['RequestStatus'];
export type DryRunResult = components['schemas']['DryRunResult'];
export type DeliveryMetrics = components['schemas']['DeliveryMetrics'];
export type Compliance = components['schemas']['Compliance'];
export type Problem = components['schemas']['Problem'];
export type Team = components['schemas']['Team'];

/** An error the platform returned as a problem document, kept intact for display. */
export class ApiError extends Error {
  constructor(readonly problem: Problem) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiError';
  }
}

export interface ClientOptions {
  baseUrl: string;
  token?: string;
  fetchImpl?: typeof fetch;
}

export class Client {
  constructor(private readonly opts: ClientOptions) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const doFetch = this.opts.fetchImpl ?? fetch;
    let res: Response;
    try {
      res = await doFetch(`${this.opts.baseUrl}${path}`, {
        method,
        headers: {
          accept: 'application/json',
          ...(this.opts.token ? { authorization: `Bearer ${this.opts.token}` } : {}),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      // A connection failure is the most common first-run problem; say what to do.
      throw new Error(`Could not reach the platform API at ${this.opts.baseUrl}: ${(e as Error).message}`);
    }

    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (res.status >= 400) throw new ApiError(data as Problem);
    return data as T;
  }

  listBuckets(filters: { environment?: string; team?: string } = {}): Promise<{ buckets: Bucket[] }> {
    const query = new URLSearchParams(
      Object.entries(filters).filter(([, v]) => v !== undefined) as [string, string][],
    ).toString();
    return this.call('GET', `/v1/buckets${query ? `?${query}` : ''}`);
  }

  describeBucket(bucketId: string): Promise<Bucket> {
    return this.call('GET', `/v1/buckets/${encodeURIComponent(bucketId)}`);
  }

  createBucket(body: BucketCreate, dryRun = false): Promise<PlatformRequest | DryRunResult> {
    return this.call('POST', `/v1/buckets${dryRun ? '?dryRun=true' : ''}`, body);
  }

  updateBucket(bucketId: string, body: BucketUpdate, dryRun = false): Promise<PlatformRequest | DryRunResult> {
    return this.call('PATCH', `/v1/buckets/${encodeURIComponent(bucketId)}${dryRun ? '?dryRun=true' : ''}`, body);
  }

  deleteBucket(bucketId: string, dryRun = false): Promise<PlatformRequest | DryRunResult> {
    return this.call('DELETE', `/v1/buckets/${encodeURIComponent(bucketId)}${dryRun ? '?dryRun=true' : ''}`);
  }

  getRequest(requestId: string): Promise<PlatformRequest> {
    return this.call('GET', `/v1/requests/${encodeURIComponent(requestId)}`);
  }

  listRequests(): Promise<{ requests: PlatformRequest[] }> {
    return this.call('GET', '/v1/requests');
  }

  metrics(): Promise<DeliveryMetrics> {
    return this.call('GET', '/v1/metrics');
  }

  compliance(): Promise<Compliance> {
    return this.call('GET', '/v1/compliance');
  }

  teams(): Promise<{ teams: Team[] }> {
    return this.call('GET', '/v1/catalog/teams');
  }
}

/** Statuses that will never change again — polling past one of these is pointless. */
export const TERMINAL: RequestStatus[] = ['applied', 'decommissioned', 'failed', 'cancelled'];

/**
 * Where `--wait` stops. `blocked` is not terminal — a human can push a fix and
 * the request carries on — but nothing the waiting process can do will move it,
 * so a pipeline should be told now rather than poll until its job times out.
 */
export const WAIT_STOP: RequestStatus[] = [...TERMINAL, 'blocked'];

/** Statuses that mean the request did NOT succeed, so the CLI exits non-zero. */
export const UNSUCCESSFUL: RequestStatus[] = ['failed', 'cancelled', 'blocked'];
