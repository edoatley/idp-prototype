import path from 'node:path';
import request from 'supertest';
import { describe, it, expect, beforeAll, vi } from 'vitest';

// The API's contract tests. Every response here is also checked against
// contracts/openapi.yaml by express-openapi-validator at runtime, so these
// assertions and the published contract cannot drift apart: a handler that
// stops matching the spec fails the suite even if the assertion below still
// passes.

const FIXTURES = path.join(__dirname, 'fixtures');

beforeAll(() => {
  process.env.PLATFORM_DIR = path.resolve(__dirname, '../../idp-gitops/platform');
  process.env.STACKS_DIR = path.join(FIXTURES, 'stacks');
  process.env.GITHUB_REPO = 'edoatley/idp-prototype';
});

async function app() {
  const { createApp } = await import('../src/server');
  return createApp();
}

describe('GET /healthz', () => {
  it('reports liveness', async () => {
    const res = await request(await app()).get('/healthz').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('GET /v1/catalog', () => {
  it('serves the teams the module validates against', async () => {
    const res = await request(await app()).get('/v1/catalog/teams').expect(200);
    expect(res.body.teams.map((t: { id: string }) => t.id)).toContain('checkout');
  });

  it('serves the environments and platform conventions', async () => {
    const res = await request(await app()).get('/v1/catalog/environments').expect(200);
    expect(res.body).toEqual({
      environments: ['dev', 'test', 'prod'],
      orgPrefix: 'edo',
      region: 'europe-west2',
    });
  });
});

describe('GET /v1/buckets', () => {
  it('lists the inventory from the GitOps repo', async () => {
    const res = await request(await app()).get('/v1/buckets').expect(200);
    expect(res.body.buckets.map((b: { bucketId: string }) => b.bucketId)).toEqual([
      'edo-dev-checkout-orders',
      'edo-prod-payments-ledger',
    ]);
  });

  it('derives the short name by stripping the owning team, not the first hyphen', async () => {
    const res = await request(await app()).get('/v1/buckets').expect(200);
    const bucket = res.body.buckets.find((b: { bucketId: string }) => b.bucketId === 'edo-prod-payments-ledger');
    expect(bucket.name).toBe('ledger');
    expect(bucket.owningTeam).toBe('payments');
  });

  it('reports the guardrails the caller inherited', async () => {
    const res = await request(await app()).get('/v1/buckets').expect(200);
    expect(res.body.buckets[0].guardrails).toEqual({
      location: 'europe-west2',
      uniformBucketLevelAccess: true,
      publicAccessPrevention: 'enforced',
      versioning: true,
      forceDestroy: false,
    });
  });

  it('filters by environment and team', async () => {
    const byEnv = await request(await app()).get('/v1/buckets?environment=prod').expect(200);
    expect(byEnv.body.buckets).toHaveLength(1);

    const byTeam = await request(await app()).get('/v1/buckets?team=checkout').expect(200);
    expect(byTeam.body.buckets).toHaveLength(1);

    const neither = await request(await app()).get('/v1/buckets?environment=prod&team=checkout').expect(200);
    expect(neither.body.buckets).toHaveLength(0);
  });

  it('rejects an environment outside the platform enum', async () => {
    const res = await request(await app()).get('/v1/buckets?environment=staging').expect(400);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body.errors).toEqual([{ field: 'environment', message: expect.stringContaining('dev, test, prod') }]);
  });
});

describe('GET /v1/buckets/{bucketId}', () => {
  it('describes a bucket', async () => {
    const res = await request(await app()).get('/v1/buckets/edo-dev-checkout-orders').expect(200);
    expect(res.body).toMatchObject({
      bucketId: 'edo-dev-checkout-orders',
      name: 'orders',
      owningTeam: 'checkout',
      environment: 'dev',
      requester: 'mei-lin',
      stackDir: 'idp-gitops/stacks/dev/checkout-orders',
    });
  });

  it('returns a problem document for an unknown bucket', async () => {
    const res = await request(await app()).get('/v1/buckets/edo-dev-nope-nope').expect(404);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body).toMatchObject({ title: 'Not found', status: 404, instance: '/v1/buckets/edo-dev-nope-nope' });
  });
});

describe('the spec drives authentication', () => {
  it.each(['/v1/metrics', '/v1/compliance', '/v1/requests'])('requires a bearer token on %s', async (route) => {
    const res = await request(await app()).get(route).expect(401);
    expect(res.body).toMatchObject({ title: 'Unauthorized', status: 401 });
    // A security rejection is not a field error — it must not name a bogus field.
    expect(res.body.errors).toBeUndefined();
  });

  it('leaves operations declaring `security: []` open', async () => {
    await request(await app()).get('/v1/catalog/teams').expect(200);
    await request(await app()).get('/v1/buckets').expect(200);
  });
});

describe('response validation', () => {
  it('fails loudly when a handler breaks the published contract', async () => {
    // The point of validating responses: if a handler starts returning something
    // the contract does not describe, that is OUR bug and must not reach a
    // client dressed as a valid answer. `staging` is not in the environment enum.
    vi.resetModules();
    vi.doMock('idp-core', async () => {
      const actual = await vi.importActual<typeof import('idp-core')>('idp-core');
      return {
        ...actual,
        listBuckets: () => [
          {
            stackDir: 'idp-gitops/stacks/staging/checkout-orders',
            bucketName: 'edo-staging-checkout-orders',
            type: 'gcs-bucket',
            owning_team: 'checkout',
            environment: 'staging',
            request_id: 'req-20260101-checkout-orders-a1b2',
            requester: 'mei-lin',
            created_at: '2026-01-01',
          },
        ],
      };
    });

    const { createApp } = await import('../src/server');
    const res = await request(createApp()).get('/v1/buckets').expect(500);
    // Specifically the RESPONSE validator, not an incidental crash.
    expect(res.body.detail).toMatch(/^\/response\/buckets\/0\/environment/);
    expect(res.body.title).toBe('Internal error');

    vi.doUnmock('idp-core');
    vi.resetModules();
  });
});
