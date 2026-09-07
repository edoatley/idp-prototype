import { describe, it, expect } from 'vitest';
import { makeFetch } from './fakeFetch';
import { GitHubPrDriver } from '../src/drivers/githubPr';
import { DryRunDriver, dryRunResult } from '../src/drivers/dryRun';
import { planCreate, planUpdate, planDelete, ChangeInFlightError } from '../src/change';
import { GitHubError } from '../src/github';
import { DEFAULT_SETTINGS } from '../src/guardrails';
import type { BucketRecord } from '../src/inventory';

const record: BucketRecord = {
  stackDir: 'idp-gitops/stacks/dev/checkout-orders',
  bucketName: 'edo-dev-checkout-orders',
  type: 'gcs-bucket',
  owning_team: 'checkout',
  environment: 'dev',
  request_id: 'req-20260101-checkout-orders-a1b2',
  requester: 'mei-lin',
  created_at: '2026-01-01',
  updated_at: '',
  updated_by: '',
  settings: { ...DEFAULT_SETTINGS },
};

const createChange = planCreate({
  request: { name: 'orders', owning_team: 'checkout', environment: 'dev' },
  requester: 'octocat',
  requestId: 'req-20260905-checkout-orders-a1b2',
  date: '2026-09-05',
});

// The happy path through the git-data API: base ref -> tree -> commit -> ref -> PR.
const submitHandlers = (prNumber: number) => [
  { method: 'GET', match: /\/contents\//, status: 404, body: { message: 'Not Found' } },
  { method: 'GET', match: /\/git\/ref\/heads\/main/, status: 200, body: { object: { sha: 'BASE' } } },
  { method: 'GET', match: /\/git\/commits\/BASE/, status: 200, body: { tree: { sha: 'BASETREE' } } },
  { method: 'POST', match: /\/git\/trees/, status: 201, body: { sha: 'NEWTREE' } },
  { method: 'POST', match: /\/git\/commits/, status: 201, body: { sha: 'NEWCOMMIT' } },
  { method: 'POST', match: /\/git\/refs/, status: 201, body: {} },
  {
    method: 'POST',
    match: /\/pulls/,
    status: 201,
    body: { html_url: `https://github.com/x/y/pull/${prNumber}`, number: prNumber },
  },
];

function driver(handlers: Parameters<typeof makeFetch>[0]) {
  const { fetchImpl, calls } = makeFetch(handlers);
  return { driver: new GitHubPrDriver({ token: 't', owner: 'edoatley', repo: 'idp-prototype', fetchImpl }), calls };
}

describe('GitHubPrDriver.submit', () => {
  it('creates one commit carrying every file, then opens the PR', async () => {
    const { driver: d, calls } = driver(submitHandlers(42));
    const result = await d.submit(createChange);

    expect(result).toEqual({
      requestId: 'req-20260905-checkout-orders-a1b2',
      number: 42,
      url: 'https://github.com/x/y/pull/42',
    });

    const tree = (calls.find((c) => c.url.includes('/git/trees'))!.body as {
      tree: Array<{ path: string; content?: string }>;
    }).tree;
    expect(tree.map((t) => t.path).sort()).toEqual([
      'idp-gitops/stacks/dev/checkout-orders/main.tf',
      'idp-gitops/stacks/dev/checkout-orders/metadata.yaml',
    ]);
    expect(tree.every((t) => (t.content ?? '').length > 0)).toBe(true);

    const ref = calls.find((c) => c.url.includes('/git/refs'))!.body as { ref: string };
    expect(ref.ref).toBe('refs/heads/idp/create-dev-checkout-orders');
  });

  it('refuses to create a stack that already exists, before anything is opened', async () => {
    const { driver: d, calls } = driver([
      { method: 'GET', match: /\/contents\//, status: 200, body: [{ name: 'main.tf' }] },
    ]);
    await expect(d.submit(createChange)).rejects.toThrow(/already exists/);
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('sends deletions as null-sha entries in the same single commit', async () => {
    const { driver: d, calls } = driver(submitHandlers(7));
    await d.submit(planDelete({ record, requester: 'octocat', requestId: 'req-20260905-checkout-orders-z9y8' }));

    const tree = (calls.find((c) => c.url.includes('/git/trees'))!.body as {
      tree: Array<{ path: string; sha: string | null }>;
    }).tree;
    expect(tree.every((t) => t.sha === null)).toBe(true);
    expect(tree.map((t) => t.path).sort()).toEqual([
      'idp-gitops/stacks/dev/checkout-orders/main.tf',
      'idp-gitops/stacks/dev/checkout-orders/metadata.yaml',
    ]);
  });

  it('does not run the collision guard for a delete — the stack is meant to exist', async () => {
    // No /contents/ handler: a request to it would throw "unexpected GET".
    const { driver: d } = driver(submitHandlers(7).filter((h) => !h.match.source.includes('contents')));
    await expect(
      d.submit(planDelete({ record, requester: 'octocat', requestId: 'req-1' })),
    ).resolves.toMatchObject({ number: 7 });
  });
});

// Status is derived from the repo, never stored. These pin the mapping from what
// GitHub reports onto what a caller is told.
describe('GitHubPrDriver.status', () => {
  const pr = (over: Record<string, unknown> = {}) => ({
    number: 42,
    title: 'Provision bucket edo-dev-checkout-orders',
    body: 'Stack: `idp-gitops/stacks/dev/checkout-orders` · request-id `req-abc`.',
    state: 'open',
    created_at: '2026-09-05T10:00:00Z',
    merged_at: null,
    html_url: 'https://github.com/x/y/pull/42',
    head: { sha: 'HEADSHA' },
    ...over,
  });

  const openPrs = (body: unknown) => ({ method: 'GET', match: /\/pulls\?state=open/, status: 200, body });
  const closedPrs = (body: unknown) => ({ method: 'GET', match: /\/pulls\?state=closed/, status: 200, body });
  const checks = (conclusions: Array<{ name: string; conclusion: string | null }>) => ({
    method: 'GET',
    match: /check-runs/,
    status: 200,
    body: { check_runs: conclusions },
  });
  const comments = (bodies: string[]) => ({
    method: 'GET',
    match: /\/issues\/42\/comments/,
    status: 200,
    body: bodies.map((b) => ({ body: b })),
  });

  it('is pending_review while the gate is green and a human has not merged', async () => {
    const { driver: d } = driver([openPrs([pr()]), checks([{ name: 'plan', conclusion: 'success' }])]);
    expect(await d.status('req-abc')).toMatchObject({ status: 'pending_review', intent: 'create' });
  });

  it('is blocked — not pending — when a check failed, because it needs a fix not a review', async () => {
    const { driver: d } = driver([openPrs([pr()]), checks([{ name: 'plan / policy gate', conclusion: 'failure' }])]);
    const status = await d.status('req-abc');
    expect(status).toMatchObject({ status: 'blocked' });
    expect(status!.message).toContain('policy gate');
  });

  it('is merged while provisioning has not yet reported back', async () => {
    const merged = pr({ state: 'closed', merged_at: '2026-09-05T11:00:00Z' });
    const { driver: d } = driver([openPrs([]), closedPrs([merged]), comments(['unrelated chatter'])]);
    expect(await d.status('req-abc')).toMatchObject({ status: 'merged' });
  });

  it('is applied once the apply workflow posts its audit comment', async () => {
    const merged = pr({ state: 'closed', merged_at: '2026-09-05T11:00:00Z' });
    const { driver: d } = driver([
      openPrs([]),
      closedPrs([merged]),
      comments(['<!-- tf-apply:idp-gitops/stacks/dev/checkout-orders -->\n### ✅ Applied — `x`\nProvisioned.']),
    ]);
    expect(await d.status('req-abc')).toMatchObject({ status: 'applied', bucketId: 'edo-dev-checkout-orders' });
  });

  it('is failed, carrying the reason, when the apply comment reports a failure', async () => {
    const merged = pr({ state: 'closed', merged_at: '2026-09-05T11:00:00Z' });
    const { driver: d } = driver([
      openPrs([]),
      closedPrs([merged]),
      comments(['<!-- tf-apply:x -->\n### ❌ Apply failed — `x`\nApply failed — see the run.']),
    ]);
    const status = await d.status('req-abc');
    expect(status).toMatchObject({ status: 'failed' });
    expect(status!.message).toContain('Apply failed');
  });

  it('reads a decommission from the destroy marker, not the apply one', async () => {
    const merged = pr({
      state: 'closed',
      merged_at: '2026-09-05T11:00:00Z',
      title: 'Decommission bucket edo-dev-checkout-orders',
    });
    const { driver: d } = driver([
      openPrs([]),
      closedPrs([merged]),
      comments(['<!-- tf-destroy:idp-gitops/stacks/dev/checkout-orders -->\n### ♻️ Decommissioned — `x`']),
    ]);
    expect(await d.status('req-abc')).toMatchObject({ status: 'decommissioned', intent: 'delete' });
  });

  it('is cancelled when the change was closed without merging', async () => {
    const closed = pr({ state: 'closed', merged_at: null });
    const { driver: d } = driver([openPrs([]), closedPrs([closed])]);
    expect(await d.status('req-abc')).toMatchObject({ status: 'cancelled' });
  });

  it('returns null for a request the platform has never seen', async () => {
    const { driver: d } = driver([openPrs([]), closedPrs([])]);
    expect(await d.status('req-nope')).toBeNull();
  });

  it('ignores pull requests that are not platform change requests', async () => {
    const human = pr({ body: 'Just a normal PR someone opened by hand.' });
    const { driver: d } = driver([openPrs([human])]);
    expect(await d.listOpen()).toEqual([]);
  });
});

describe('DryRunDriver', () => {
  it('renders the change without submitting anything', async () => {
    const d = new DryRunDriver();
    const result = await d.submit(createChange);
    expect(result.url).toBe('dry-run://not-submitted');
    expect(d.submitted).toHaveLength(1);
  });

  it('summarises what would be written, including deletions', () => {
    const del = dryRunResult(planDelete({ record, requester: 'octocat', requestId: 'req-1' }));
    expect(del.summary).toBe('remove idp-gitops/stacks/dev/checkout-orders (2 files)');
    expect(del.files.every((f) => f.content === null)).toBe(true);

    const create = dryRunResult(createChange);
    expect(create.summary).toBe('create idp-gitops/stacks/dev/checkout-orders (2 files)');
    expect(create.files.every((f) => typeof f.content === 'string')).toBe(true);
  });
});

describe('planUpdate', () => {
  it('carries the original provenance through and records who changed it', () => {
    const change = planUpdate({
      record,
      name: 'orders',
      settings: { ...DEFAULT_SETTINGS, retentionDays: 30 },
      requester: 'ravi-menon',
      requestId: 'req-20260905-checkout-orders-u1u2',
      date: '2026-09-06',
    });

    const metadata = change.files.find((f) => f.path.endsWith('metadata.yaml'))!.content!;
    // The bucket's identity and provenance are immutable; only the change author moves.
    expect(metadata).toContain('request_id: req-20260101-checkout-orders-a1b2');
    expect(metadata).toContain('requester: mei-lin');
    expect(metadata).toContain('created_at: "2026-01-01"');
    expect(metadata).toContain('updated_by: ravi-menon');

    expect(change.files.find((f) => f.path.endsWith('main.tf'))!.content).toContain('retention_days = 30');
    expect(change.title).toBe('Update bucket edo-dev-checkout-orders');
    expect(change.branch).toBe('idp/update-dev-checkout-orders');
    expect(change.body).toContain('expire noncurrent versions after 30 days');
  });
});

// The failure paths. These are the tests whose absence let a rejected credential
// reach a user as "Internal error": every other test in this file stubs GitHub
// with a SUCCESSFUL response, so nothing exercised what happens when it does not.
describe('GitHub failures keep their cause', () => {
  it('raises the status and GitHub\'s own message instead of returning an error body as data', async () => {
    const { driver: d } = driver([
      { method: 'GET', match: /\/pulls\?state=open/, status: 401, body: { message: 'Bad credentials' } },
    ]);

    const err = await d.listOpen().catch((e) => e);
    expect(err).toBeInstanceOf(GitHubError);
    expect(err.status).toBe(401);
    expect(err.githubMessage).toBe('Bad credentials');
    // Previously this surfaced as "prs.data.filter is not a function".
    expect(err.message).toContain('Bad credentials');
  });

  it('raises on a rate limit rather than reporting an empty result', async () => {
    const { driver: d } = driver([
      { method: 'GET', match: /\/pulls\?state=open/, status: 403, body: { message: 'API rate limit exceeded' } },
    ]);
    await expect(d.listOpen()).rejects.toMatchObject({ status: 403 });
  });

  it('reports the status, not a parse error, when a proxy returns an HTML page', async () => {
    const html = (async () => ({ status: 502, text: async () => '<html>bad gateway</html>' })) as unknown as typeof fetch;
    const d = new GitHubPrDriver({ token: 't', owner: 'o', repo: 'r', fetchImpl: html });
    await expect(d.listOpen()).rejects.toMatchObject({ status: 502 });
  });

  it('still tolerates the 404 the collision guard depends on', async () => {
    // 404 means "the stack is free" — the one status that must NOT raise.
    const { driver: d } = driver(submitHandlers(11));
    await expect(d.submit(createChange)).resolves.toMatchObject({ number: 11 });
  });
});

// Branch names are deterministic per intent+stack, so ref creation is the lock.
describe('creating the branch is the concurrency lock', () => {
  it('refuses when the branch already exists, rather than opening a second PR', async () => {
    const handlers = submitHandlers(0)
      .filter((h) => !h.match.source.includes('refs') && !h.match.source.includes('pulls'))
      .concat([
        { method: 'POST', match: /\/git\/refs/, status: 422, body: { message: 'Reference already exists' } },
        // A PR call here would mean the guard failed to stop the write.
        { method: 'POST', match: /\/pulls/, status: 201, body: { html_url: 'u', number: 1 } },
      ]);
    const { driver: d, calls } = driver(handlers);

    const err = await d.submit(createChange).catch((e) => e);
    expect(err).toBeInstanceOf(ChangeInFlightError);
    expect(err.bucketId).toBe('edo-dev-checkout-orders');
    expect(calls.some((c) => c.url.endsWith('/pulls'))).toBe(false);
  });
});

describe('findOpenFor', () => {
  const openPr = (title: string, requestId: string, number: number) => ({
    number,
    title,
    body: `Stack: \`idp-gitops/stacks/dev/checkout-orders\` · request-id \`${requestId}\`.`,
    state: 'open',
    created_at: '2026-09-05T10:00:00Z',
    merged_at: null,
    html_url: `https://github.com/x/y/pull/${number}`,
    head: { sha: 'SHA' },
  });

  const listing = (prs: unknown[]) => [
    { method: 'GET', match: /\/pulls\?state=open/, status: 200, body: prs },
  ];

  it('finds the open change targeting a bucket', async () => {
    const { driver: d } = driver(
      listing([openPr('Update bucket edo-dev-checkout-orders', 'req-live', 7)]),
    );
    expect(await d.findOpenFor('edo-dev-checkout-orders')).toMatchObject({
      requestId: 'req-live',
      intent: 'update',
      number: 7,
      url: 'https://github.com/x/y/pull/7',
    });
  });

  it('costs exactly one request, whatever the number of open changes', async () => {
    // The point of the method: answering "is anything in flight?" must not
    // resolve a status — and a check-run call per open PR — on every write.
    const prs = Array.from({ length: 5 }, (_, i) =>
      openPr(`Provision bucket edo-dev-team-${i}`, `req-${i}`, i + 1),
    );
    const { driver: d, calls } = driver(listing(prs));

    await d.findOpenFor('edo-dev-team-3');
    expect(calls).toHaveLength(1);
    expect(calls.every((c) => !c.url.includes('check-runs'))).toBe(true);
  });

  it('is null when nothing targets that bucket', async () => {
    const { driver: d } = driver(listing([openPr('Provision bucket edo-dev-other-thing', 'req-x', 3)]));
    expect(await d.findOpenFor('edo-dev-checkout-orders')).toBeNull();
  });
});
