import path from 'node:path';
import request from 'supertest';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { clearIdentityCache } from 'idp-core';

// Write-path contract tests. Requests AND responses are validated against
// contracts/openapi.yaml by express-openapi-validator, so these also prove the
// published contract describes what the API actually does.
//
// GitHub is stubbed at the fetch boundary — the same seam the driver's own unit
// tests use — so nothing here touches the network or needs a credential.

const FIXTURES = path.join(__dirname, 'fixtures');
const TOKEN = 'Bearer ghp_faketoken';

beforeAll(() => {
  process.env.PLATFORM_DIR = path.resolve(__dirname, '../../idp-gitops/platform');
  process.env.STACKS_DIR = path.join(FIXTURES, 'stacks');
  process.env.GITHUB_REPO = 'edoatley/idp-prototype';
});

type Handler = { method: string; match: RegExp; status: number; body: unknown };

const OPEN_PRS_EMPTY: Handler = { method: 'GET', match: /\/pulls\?state=open/, status: 200, body: [] };

// Writes resolve the caller's identity from their token rather than trusting a
// self-declared name, so every write stub has to answer /user.
const WHOAMI: Handler = { method: 'GET', match: /api\.github\.com\/user$/, status: 200, body: { login: 'ada-okafor' } };

const SUBMIT_OK: Handler[] = [
  WHOAMI,
  { method: 'GET', match: /\/contents\//, status: 404, body: { message: 'Not Found' } },
  { method: 'GET', match: /\/git\/ref\/heads\/main/, status: 200, body: { object: { sha: 'BASE' } } },
  { method: 'GET', match: /\/git\/commits\/BASE/, status: 200, body: { tree: { sha: 'BASETREE' } } },
  { method: 'POST', match: /\/git\/trees/, status: 201, body: { sha: 'NEWTREE' } },
  { method: 'POST', match: /\/git\/commits/, status: 201, body: { sha: 'NEWCOMMIT' } },
  { method: 'POST', match: /\/git\/refs/, status: 201, body: {} },
  { method: 'POST', match: /\/pulls/, status: 201, body: { html_url: 'https://github.com/x/y/pull/99', number: 99 } },
];

let calls: Array<{ method: string; url: string; body: unknown }> = [];

function stubGitHub(handlers: Handler[]): void {
  calls = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body ? JSON.parse(init.body as string) : undefined });
    const h = handlers.find((x) => x.method === method && x.match.test(url));
    if (!h) throw new Error(`unexpected ${method} ${url}`);
    return { status: h.status, text: async () => JSON.stringify(h.body) } as Response;
  });
}

async function app() {
  const { createApp } = await import('../src/server');
  return createApp();
}

beforeEach(() => {
  vi.unstubAllGlobals();
  // The login cache is process-wide; without this a stubbed identity would leak
  // into the next test.
  clearIdentityCache();
});

const validCreate = { name: 'invoices', owningTeam: 'payments', environment: 'dev', requester: 'ada-okafor' };

describe('POST /v1/buckets', () => {
  it('accepts a valid request and points at the change to follow', async () => {
    stubGitHub([OPEN_PRS_EMPTY, ...SUBMIT_OK]);
    const res = await request(await app()).post('/v1/buckets').set('authorization', TOKEN).send(validCreate).expect(202);

    expect(res.headers.location).toBe(`/v1/requests/${res.body.requestId}`);
    expect(res.body).toMatchObject({
      intent: 'create',
      status: 'pending_review',
      bucketId: 'edo-dev-payments-invoices',
      stackDir: 'idp-gitops/stacks/dev/payments-invoices',
      review: { url: 'https://github.com/x/y/pull/99', number: 99 },
    });
  });

  it('commits the generated stack — the same files a human would have written', async () => {
    stubGitHub([OPEN_PRS_EMPTY, ...SUBMIT_OK]);
    await request(await app()).post('/v1/buckets').set('authorization', TOKEN).send(validCreate).expect(202);

    const tree = (calls.find((c) => c.url.includes('/git/trees'))!.body as {
      tree: Array<{ path: string; content: string }>;
    }).tree;
    expect(tree.map((t) => t.path).sort()).toEqual([
      'idp-gitops/stacks/dev/payments-invoices/main.tf',
      'idp-gitops/stacks/dev/payments-invoices/metadata.yaml',
    ]);
    expect(tree.find((t) => t.path.endsWith('main.tf'))!.content).toContain('source = "../../../modules/gcs-bucket"');
  });

  it('requires a token — this is the one place a credential is needed', async () => {
    await request(await app()).post('/v1/buckets').send(validCreate).expect(401);
  });

  it('rejects a team the platform does not know, naming the field', async () => {
    const res = await request(await app())
      .post('/v1/buckets')
      .set('authorization', TOKEN)
      .send({ ...validCreate, owningTeam: 'nosuchteam' })
      .expect(400);
    expect(res.body.errors).toContainEqual({ field: 'owning_team', message: expect.stringContaining('known team') });
  });

  it('rejects a name that violates the naming convention before anything is opened', async () => {
    stubGitHub([]); // any GitHub call would throw
    await request(await app())
      .post('/v1/buckets')
      .set('authorization', TOKEN)
      .send({ ...validCreate, name: 'Not_Valid' })
      .expect(400);
    expect(calls).toHaveLength(0);
  });

  it('refuses to let a caller claim one of the platform-reserved labels', async () => {
    const res = await request(await app())
      .post('/v1/buckets')
      .set('authorization', TOKEN)
      .send({ ...validCreate, settings: { extraLabels: { 'managed-by': 'not-idp' } } })
      .expect(400);
    expect(res.body.errors).toContainEqual({ field: 'extraLabels', message: expect.stringContaining('managed-by') });
  });

  it('is a conflict when the bucket already exists', async () => {
    const res = await request(await app())
      .post('/v1/buckets')
      .set('authorization', TOKEN)
      .send({ name: 'orders', owningTeam: 'checkout', environment: 'dev', requester: 'mei-lin' })
      .expect(409);
    expect(res.body.type).toBe('/problems/bucket-exists');
  });

  it('is a conflict when another change is already open against the bucket', async () => {
    stubGitHub([
      {
        method: 'GET',
        match: /\/pulls\?state=open/,
        status: 200,
        body: [
          {
            number: 5,
            title: 'Provision bucket edo-dev-payments-invoices',
            body: 'Stack: `idp-gitops/stacks/dev/payments-invoices` · request-id `req-earlier`.',
            state: 'open',
            created_at: '2026-09-05T10:00:00Z',
            merged_at: null,
            html_url: 'https://github.com/x/y/pull/5',
            head: { sha: 'SHA' },
          },
        ],
      },
      { method: 'GET', match: /check-runs/, status: 200, body: { check_runs: [] } },
    ]);

    const res = await request(await app()).post('/v1/buckets').set('authorization', TOKEN).send(validCreate).expect(409);
    expect(res.body.type).toBe('/problems/request-in-flight');
    expect(res.body.detail).toContain('req-earlier');
  });
});

describe('dry run', () => {
  it('renders exactly what would be committed without opening anything', async () => {
    stubGitHub([WHOAMI]); // identity resolves; nothing may be written
    const res = await request(await app())
      .post('/v1/buckets?dryRun=true')
      .set('authorization', TOKEN)
      .send({ ...validCreate, settings: { retentionDays: 30 } })
      .expect(200);

    // Nothing was written — the only call is the read that names the author.
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
    expect(res.body.summary).toBe('create idp-gitops/stacks/dev/payments-invoices (2 files)');
    const mainTf = res.body.files.find((f: { path: string }) => f.path.endsWith('main.tf'));
    expect(mainTf.content).toContain('retention_days = 30');
  });

  it('shows a decommission as the removal of every stack file', async () => {
    stubGitHub([WHOAMI]);
    const res = await request(await app())
      .delete('/v1/buckets/edo-dev-checkout-orders?dryRun=true')
      .set('authorization', TOKEN)
      .expect(200);

    expect(res.body.intent).toBe('delete');
    expect(res.body.files.every((f: { content: null }) => f.content === null)).toBe(true);
  });
});

describe('PATCH /v1/buckets/{bucketId}', () => {
  it('regenerates the stack with the new settings, preserving provenance', async () => {
    stubGitHub([OPEN_PRS_EMPTY, ...SUBMIT_OK]);
    const res = await request(await app())
      .patch('/v1/buckets/edo-dev-checkout-orders')
      .set('authorization', TOKEN)
      .send({ retentionDays: 30, storageClass: 'NEARLINE' })
      .expect(202);

    expect(res.body.intent).toBe('update');

    const tree = (calls.find((c) => c.url.includes('/git/trees'))!.body as {
      tree: Array<{ path: string; content: string }>;
    }).tree;
    const mainTf = tree.find((t) => t.path.endsWith('main.tf'))!.content;
    expect(mainTf).toContain('retention_days = 30');
    expect(mainTf).toContain('storage_class  = "NEARLINE"');
    // The original request id is provenance and must survive the update.
    expect(mainTf).toContain('request_id     = "req-20260101-checkout-orders-a1b2"');
  });

  it('leaves settings the caller did not mention alone', async () => {
    stubGitHub([WHOAMI]);
    const res = await request(await app())
      .patch('/v1/buckets/edo-dev-checkout-orders?dryRun=true')
      .set('authorization', TOKEN)
      .send({ storageClass: 'NEARLINE' })
      .expect(200);

    const mainTf = res.body.files.find((f: { path: string }) => f.path.endsWith('main.tf')).content;
    expect(mainTf).toContain('storage_class');
    expect(mainTf).not.toContain('retention_days');
  });

  it('rejects an attempt to change immutable identity rather than ignoring it', async () => {
    // Renaming would destroy and recreate the bucket; silently dropping the field
    // would tell the caller the change succeeded when nothing happened.
    const res = await request(await app())
      .patch('/v1/buckets/edo-dev-checkout-orders')
      .set('authorization', TOKEN)
      .send({ owningTeam: 'payments' })
      .expect(400);
    expect(res.body.status).toBe(400);
  });

  it('404s for a bucket the platform does not have', async () => {
    await request(await app())
      .patch('/v1/buckets/edo-dev-nope-nope')
      .set('authorization', TOKEN)
      .send({ retentionDays: 30 })
      .expect(404);
  });
});

describe('GET /v1/requests/{requestId}', () => {
  it('resolves status live from the repo', async () => {
    stubGitHub([
      {
        method: 'GET',
        match: /\/pulls\?state=open/,
        status: 200,
        body: [
          {
            number: 42,
            title: 'Provision bucket edo-dev-payments-invoices',
            body: 'Stack: `idp-gitops/stacks/dev/payments-invoices` · request-id `req-abc`.',
            state: 'open',
            created_at: '2026-09-05T10:00:00Z',
            merged_at: null,
            html_url: 'https://github.com/x/y/pull/42',
            head: { sha: 'SHA' },
          },
        ],
      },
      { method: 'GET', match: /check-runs/, status: 200, body: { check_runs: [{ name: 'plan', conclusion: 'success' }] } },
    ]);

    const res = await request(await app()).get('/v1/requests/req-abc').set('authorization', TOKEN).expect(200);
    expect(res.body).toMatchObject({ requestId: 'req-abc', status: 'pending_review', intent: 'create' });
  });

  it('404s for an unknown request', async () => {
    stubGitHub([
      OPEN_PRS_EMPTY,
      { method: 'GET', match: /\/pulls\?state=closed/, status: 200, body: [] },
    ]);
    await request(await app()).get('/v1/requests/req-nope').set('authorization', TOKEN).expect(404);
  });
});

// What the caller is actually told when GitHub says no. Before statuses were
// checked, every one of these was a 500 "Internal error" (or, for the reads, a
// 502 whose detail was "filter is not a function") — a credential problem
// reported as a platform bug.
describe('upstream failures are reported as the caller\'s problem or ours, correctly', () => {
  const rejects = (status: number, message: string): Handler[] => [
    { method: 'GET', match: /./, status, body: { message } },
    { method: 'POST', match: /./, status, body: { message } },
  ];

  it('turns a rejected token into 401, naming the cause', async () => {
    stubGitHub(rejects(401, 'Bad credentials'));
    const res = await request(await app())
      .post('/v1/buckets')
      .set('authorization', TOKEN)
      .send(validCreate)
      .expect(401);

    expect(res.body.title).toBe('Unauthorized');
    expect(res.body.detail).toContain('Bad credentials');
    expect(res.body.detail).toMatch(/expired|permission|Contents/i);
  });

  it('turns a rate limit into 403, not a 500', async () => {
    stubGitHub(rejects(403, 'API rate limit exceeded'));
    const res = await request(await app())
      .post('/v1/buckets')
      .set('authorization', TOKEN)
      .send(validCreate)
      .expect(403);
    expect(res.body.detail).toContain('rate limit');
  });

  it('reports a genuine GitHub outage as 502 — that one IS ours', async () => {
    stubGitHub(rejects(503, 'Service unavailable'));
    await request(await app()).post('/v1/buckets').set('authorization', TOKEN).send(validCreate).expect(502);
  });

  it.each(['/v1/metrics', '/v1/compliance'])('does not bury a rejected token behind a 502 on %s', async (route) => {
    stubGitHub(rejects(401, 'Bad credentials'));
    const res = await request(await app()).get(route).set('authorization', TOKEN).expect(401);
    expect(res.body.detail).toContain('Bad credentials');
  });

  it('answers 409 when the branch already exists, even if the pre-check saw nothing', async () => {
    // The race the read-then-write pre-check cannot close: listOpen comes back
    // empty, but the ref already exists by the time we create it.
    stubGitHub([
      OPEN_PRS_EMPTY,
      ...SUBMIT_OK.filter((h) => !h.match.source.includes('refs')),
      { method: 'POST', match: /\/git\/refs/, status: 422, body: { message: 'Reference already exists' } },
    ]);

    const res = await request(await app())
      .post('/v1/buckets')
      .set('authorization', TOKEN)
      .send(validCreate)
      .expect(409);
    expect(res.body.type).toBe('/problems/request-in-flight');
  });
});

// Attribution comes from the credential, not from what the caller says about
// themselves. Previously PATCH and DELETE read an `x-idp-requester` header that
// existed in neither the contract nor the CLI, so a change was recorded against
// whoever created the bucket.
describe('changes are attributed to the authenticated caller', () => {
  const asUser = (login: string): Handler[] => [
    { method: 'GET', match: /api\.github\.com\/user$/, status: 200, body: { login } },
    ...SUBMIT_OK.filter((h) => !h.match.source.includes('user')),
    OPEN_PRS_EMPTY,
  ];

  const committedFile = (name: string): string =>
    (calls.find((c) => c.url.includes('/git/trees'))!.body as {
      tree: Array<{ path: string; content: string }>;
    }).tree.find((t) => t.path.endsWith(name))!.content;

  it('records the token holder as the author of an update, not the original requester', async () => {
    stubGitHub(asUser('ravi-menon'));
    await request(await app())
      .patch('/v1/buckets/edo-dev-checkout-orders')
      .set('authorization', TOKEN)
      .send({ retentionDays: 30 })
      .expect(202);

    const metadata = committedFile('metadata.yaml');
    expect(metadata).toContain('updated_by: ravi-menon');
    // The bucket's provenance is untouched — mei-lin asked for it originally.
    expect(metadata).toContain('requester: mei-lin');
  });

  it('ignores a header trying to claim someone else made the change', async () => {
    stubGitHub(asUser('ravi-menon'));
    await request(await app())
      .patch('/v1/buckets/edo-dev-checkout-orders')
      .set('authorization', TOKEN)
      .set('x-idp-requester', 'someone-else')
      .send({ retentionDays: 30 })
      .expect(202);

    expect(committedFile('metadata.yaml')).toContain('updated_by: ravi-menon');
  });

  it('defaults a new bucket to the caller when no requester is given', async () => {
    stubGitHub(asUser('mei-lin'));
    await request(await app())
      .post('/v1/buckets')
      .set('authorization', TOKEN)
      .send({ name: 'invoices', owningTeam: 'payments', environment: 'dev' })
      .expect(202);

    expect(committedFile('metadata.yaml')).toContain('requester: mei-lin');
  });

  it('still honours an explicit requester, which the portal form needs', async () => {
    // A browser visitor holds no token, so the form asks who they are.
    stubGitHub(asUser('idp-bot'));
    await request(await app())
      .post('/v1/buckets')
      .set('authorization', TOKEN)
      .send({ ...validCreate, requester: 'tomas-novak' })
      .expect(202);

    expect(committedFile('metadata.yaml')).toContain('requester: tomas-novak');
  });

  it('previews the real author, so the dry run matches what would be committed', async () => {
    // The dry run's whole promise is that there is no difference between the
    // preview and the thing itself. A placeholder author would be a difference,
    // in the one feature that exists to have none.
    stubGitHub([{ method: 'GET', match: /api\.github\.com\/user$/, status: 200, body: { login: 'ada-okafor' } }]);
    const res = await request(await app())
      .post('/v1/buckets?dryRun=true')
      .set('authorization', TOKEN)
      .send({ name: 'invoices', owningTeam: 'payments', environment: 'dev' })
      .expect(200);

    const metadata = res.body.files.find((f: { path: string }) => f.path.endsWith('metadata.yaml')).content;
    expect(metadata).toContain('requester: ada-okafor');
    expect(metadata).not.toContain('dry-run');
  });

  it('reports a token GitHub will not identify as 401, not 500', async () => {
    stubGitHub([{ method: 'GET', match: /api\.github\.com\/user$/, status: 401, body: { message: 'Bad credentials' } }]);
    await request(await app())
      .patch('/v1/buckets/edo-dev-checkout-orders')
      .set('authorization', TOKEN)
      .send({ retentionDays: 30 })
      .expect(401);
  });
});
