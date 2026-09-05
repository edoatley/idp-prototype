import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Client, ApiError } from '../src/client';
import { table, keyValue, render, pct, statusLabel } from '../src/output';
import { buildProgram } from '../src/main';

// The CLI is a pure API client, so these tests stub fetch and assert on the two
// things the CLI is actually responsible for: the requests it makes and what it
// prints. Everything else is the API's job and is tested there.

const API = 'http://api.test';

function stubFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: unknown }> = [];
  let i = 0;
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    const r = responses[Math.min(i++, responses.length - 1)]!;
    return { status: r.status, text: async () => JSON.stringify(r.body) } as Response;
  });
  return calls;
}

let out: string[] = [];
let err: string[] = [];

beforeEach(() => {
  out = [];
  err = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => void out.push(a.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...a) => void err.push(a.join(' ')));
  process.exitCode = undefined;
  // Poll immediately rather than stubbing global timers, which destabilises the
  // test worker.
  process.env.IDP_POLL_INTERVAL_MS = '0';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

const run = (argv: string[]) => buildProgram().parseAsync(['node', 'idp', '--api-url', API, ...argv]);

const bucket = {
  bucketId: 'edo-dev-checkout-orders',
  name: 'orders',
  environment: 'dev',
  owningTeam: 'checkout',
  type: 'gcs-bucket',
  requestId: 'req-1',
  requester: 'mei-lin',
  createdAt: '2026-01-01',
  stackDir: 'idp-gitops/stacks/dev/checkout-orders',
  guardrails: {
    location: 'europe-west2',
    uniformBucketLevelAccess: true,
    publicAccessPrevention: 'enforced',
    versioning: true,
    forceDestroy: false,
  },
  settings: { retentionDays: 30, storageClass: 'STANDARD', extraLabels: {} },
};

describe('Client', () => {
  it('sends the caller token as a bearer credential', async () => {
    const calls = stubFetch([{ status: 200, body: { buckets: [] } }]);
    await new Client({ baseUrl: API, token: 'ghp_x' }).listBuckets();
    expect(calls[0]!.headers.authorization).toBe('Bearer ghp_x');
  });

  it('omits the authorization header entirely when there is no token', async () => {
    const calls = stubFetch([{ status: 200, body: { buckets: [] } }]);
    await new Client({ baseUrl: API }).listBuckets();
    expect(calls[0]!.headers.authorization).toBeUndefined();
  });

  it('builds filter query strings, skipping absent filters', async () => {
    const calls = stubFetch([{ status: 200, body: { buckets: [] } }]);
    await new Client({ baseUrl: API }).listBuckets({ team: 'checkout' });
    expect(calls[0]!.url).toBe(`${API}/v1/buckets?team=checkout`);
  });

  it('turns a problem document into an error that keeps its field detail', async () => {
    stubFetch([
      {
        status: 400,
        body: { title: 'Validation failed', status: 400, detail: 'bad', errors: [{ field: 'name', message: 'nope' }] },
      },
    ]);
    const e = await new Client({ baseUrl: API }).listBuckets().catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).problem.errors).toEqual([{ field: 'name', message: 'nope' }]);
  });

  it('explains a connection failure instead of leaking a fetch error', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(new Client({ baseUrl: API }).listBuckets()).rejects.toThrow(/Could not reach the platform API/);
  });
});

describe('output', () => {
  it('aligns table columns to the widest cell', () => {
    expect(table(['A', 'BB'], [['xxxx', 'y']])).toBe(['A     BB', '----  --', 'xxxx  y'].join('\n'));
  });

  it('says so plainly when there is nothing to show', () => {
    expect(table(['A'], [])).toBe('(none)');
  });

  it('renders json and yaml from the same data', () => {
    const data = { a: 1 };
    expect(render('json', data, () => 'T')).toBe('{\n  "a": 1\n}');
    expect(render('yaml', data, () => 'T')).toBe('a: 1\n');
    expect(render('table', data, () => 'T')).toBe('T');
  });

  it('shows an unmeasured rate as a dash, never as zero', () => {
    expect(pct(null)).toBe('-');
    expect(pct(0)).toBe('0%');
  });

  it('glyphs a status so a long list scans', () => {
    expect(statusLabel('applied')).toContain('applied');
    expect(keyValue([['a', '1'], ['bbb', '2']])).toBe('a:    1\nbbb:  2');
  });
});

describe('bucket list', () => {
  it('renders the inventory as a table', async () => {
    stubFetch([{ status: 200, body: { buckets: [bucket] } }]);
    await run(['bucket', 'list']);
    expect(out.join('\n')).toContain('edo-dev-checkout-orders');
    expect(out.join('\n')).toContain('30d');
  });

  it('passes filters through to the API', async () => {
    const calls = stubFetch([{ status: 200, body: { buckets: [] } }]);
    await run(['bucket', 'list', '--environment', 'prod', '--team', 'payments']);
    expect(calls[0]!.url).toContain('environment=prod');
    expect(calls[0]!.url).toContain('team=payments');
  });

  it('emits machine-readable output for a pipeline', async () => {
    stubFetch([{ status: 200, body: { buckets: [bucket] } }]);
    await run(['bucket', 'list', '-o', 'json']);
    expect(JSON.parse(out.join('\n'))[0].bucketId).toBe('edo-dev-checkout-orders');
  });
});

describe('bucket create', () => {
  it('maps flags onto the request body the contract describes', async () => {
    const calls = stubFetch([
      { status: 202, body: { requestId: 'req-9', intent: 'create', status: 'pending_review', bucketId: 'b', stackDir: 's', submittedAt: 'now', review: { url: 'u', number: 1 } } },
    ]);
    await run([
      'bucket', 'create',
      '--name', 'orders', '--team', 'checkout', '--env', 'dev', '--requester', 'octocat',
      '--retention-days', '30', '--storage-class', 'NEARLINE', '--label', 'cost-centre=cc-1',
    ]);
    expect(calls[0]!.body).toEqual({
      name: 'orders',
      owningTeam: 'checkout',
      environment: 'dev',
      requester: 'octocat',
      settings: { retentionDays: 30, storageClass: 'NEARLINE', extraLabels: { 'cost-centre': 'cc-1' } },
    });
  });

  it('sends no settings block at all when the caller asked for none', async () => {
    const calls = stubFetch([
      { status: 202, body: { requestId: 'r', intent: 'create', status: 'pending_review', bucketId: 'b', stackDir: 's', submittedAt: 'n', review: { url: 'u' } } },
    ]);
    await run(['bucket', 'create', '--name', 'orders', '--team', 'checkout', '--env', 'dev', '--requester', 'o']);
    expect(calls[0]!.body).not.toHaveProperty('settings');
  });

  it('adds the dryRun flag and prints the rendered files instead of a request', async () => {
    const calls = stubFetch([
      {
        status: 200,
        body: {
          intent: 'create',
          bucketId: 'edo-dev-checkout-orders',
          stackDir: 'idp-gitops/stacks/dev/checkout-orders',
          summary: 'create idp-gitops/stacks/dev/checkout-orders (2 files)',
          files: [{ path: 'idp-gitops/stacks/dev/checkout-orders/main.tf', content: 'module "bucket" {}' }],
        },
      },
    ]);
    await run(['bucket', 'create', '--name', 'orders', '--team', 'checkout', '--env', 'dev', '--requester', 'o', '--dry-run']);
    expect(calls[0]!.url).toContain('dryRun=true');
    expect(out.join('\n')).toContain('nothing was opened');
    expect(out.join('\n')).toContain('module "bucket" {}');
  });

  it('rejects a malformed label before making any call', async () => {
    const calls = stubFetch([{ status: 200, body: {} }]);
    await expect(
      run(['bucket', 'create', '--name', 'o', '--team', 't', '--env', 'dev', '--requester', 'r', '--label', 'novalue']),
    ).rejects.toThrow(/key=value/);
    expect(calls).toHaveLength(0);
  });
});

describe('bucket update', () => {
  it('sends only the settings the caller named', async () => {
    const calls = stubFetch([
      { status: 202, body: { requestId: 'r', intent: 'update', status: 'pending_review', bucketId: 'b', stackDir: 's', submittedAt: 'n', review: { url: 'u' } } },
    ]);
    await run(['bucket', 'update', 'edo-dev-checkout-orders', '--storage-class', 'NEARLINE']);
    expect(calls[0]!.method).toBe('PATCH');
    expect(calls[0]!.body).toEqual({ storageClass: 'NEARLINE' });
  });

  it('sends an explicit null to reset retention to the platform default', async () => {
    const calls = stubFetch([
      { status: 202, body: { requestId: 'r', intent: 'update', status: 'pending_review', bucketId: 'b', stackDir: 's', submittedAt: 'n', review: { url: 'u' } } },
    ]);
    await run(['bucket', 'update', 'edo-dev-checkout-orders', '--clear-retention']);
    expect(calls[0]!.body).toEqual({ retentionDays: null });
  });

  it('refuses an update that would change nothing', async () => {
    const calls = stubFetch([{ status: 200, body: {} }]);
    await expect(run(['bucket', 'update', 'edo-dev-checkout-orders'])).rejects.toThrow(/Nothing to change/);
    expect(calls).toHaveLength(0);
  });
});

// The behaviour a CI job depends on: block until the platform is done, then let
// the shell know whether it worked.
describe('request status --wait', () => {
  const req = (status: string) => ({
    requestId: 'req-9',
    intent: 'create',
    status,
    bucketId: 'edo-dev-checkout-orders',
    stackDir: 's',
    submittedAt: 'n',
    review: { url: 'u', number: 1 },
  });

  it('polls until a terminal status and exits zero on success', async () => {
    stubFetch([
      { status: 200, body: req('pending_review') },
      { status: 200, body: req('merged') },
      { status: 200, body: req('applied') },
    ]);
    await run(['request', 'status', 'req-9', '--wait']);
    expect(out.join('\n')).toContain('applied');
    expect(process.exitCode).toBeUndefined();
  });

  it('exits non-zero when the request was blocked, so a pipeline fails', async () => {
    stubFetch([{ status: 200, body: { ...req('blocked'), message: 'policy gate denied' } }]);
    await run(['request', 'status', 'req-9', '--wait']);
    expect(process.exitCode).toBe(1);
  });
});
