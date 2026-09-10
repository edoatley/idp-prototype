import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The GitHub-backed inventory as the API actually serves it: env -> source ->
// handler -> contract. idp-core's own tests prove the reading; this proves the
// wiring, including that an unreadable inventory reaches the caller as a 502 and
// not as a stale list, an empty list, or somebody else's 401.

const FIXTURES = path.join(__dirname, 'fixtures');
const STACKS = path.join(FIXTURES, 'stacks');

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const fixture = (env: string, dir: string) => fs.readFileSync(path.join(STACKS, env, dir, 'metadata.yaml'), 'utf8');

const TREE = {
  truncated: false,
  tree: [
    { path: 'idp-gitops/stacks/dev/checkout-orders/metadata.yaml', type: 'blob', sha: 'a'.repeat(40) },
    { path: 'idp-gitops/stacks/prod/payments-ledger/metadata.yaml', type: 'blob', sha: 'b'.repeat(40) },
  ],
};

type Handler = { match: RegExp; status?: number; body: unknown };

function stubGitHub(handlers: Handler[]): void {
  vi.stubGlobal('fetch', async (url: string) => {
    const h = handlers.find((x) => x.match.test(url));
    if (!h) throw new Error(`unexpected GET ${url}`);
    return { status: h.status ?? 200, text: async () => JSON.stringify(h.body) } as Response;
  });
}

async function app() {
  const { createApp } = await import('../src/server');
  return createApp();
}

beforeEach(async () => {
  vi.resetModules();
  vi.unstubAllGlobals();
  // Imported after resetModules on purpose: a statically imported
  // clearInventoryCache would clear a different module instance's cache than the
  // one the app under test uses, and quietly do nothing.
  const { clearInventoryCache } = await import('idp-core');
  clearInventoryCache();
  process.env.PLATFORM_DIR = path.resolve(__dirname, '../../idp-gitops/platform');
  process.env.STACKS_DIR = STACKS;
  process.env.GITHUB_REPO = 'edoatley/idp-prototype';
  process.env.GITHUB_TOKEN = 'ghp_faketoken';
  process.env.IDP_INVENTORY = 'github';
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env.IDP_INVENTORY = 'file';
  delete process.env.GITHUB_TOKEN;
});

describe('the API served from the GitHub inventory', () => {
  it('answers with what the base branch declares, not what is on disk', async () => {
    stubGitHub([
      { match: /\/git\/trees\/main\?recursive=1/, body: TREE },
      { match: /\/git\/blobs\/a{40}/, body: { encoding: 'base64', content: b64(fixture('dev', 'checkout-orders')) } },
      { match: /\/git\/blobs\/b{40}/, body: { encoding: 'base64', content: b64(fixture('prod', 'payments-ledger')) } },
    ]);

    const res = await request(await app()).get('/v1/buckets').expect(200);
    expect(res.body.buckets.map((b: { bucketId: string }) => b.bucketId)).toEqual([
      'edo-dev-checkout-orders',
      'edo-prod-payments-ledger',
    ]);
  });

  it('spends one tree call per request, however many times a handler reads it', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url);
      const body = /blobs\/a{40}/.test(url)
        ? { encoding: 'base64', content: b64(fixture('dev', 'checkout-orders')) }
        : /blobs\/b{40}/.test(url)
          ? { encoding: 'base64', content: b64(fixture('prod', 'payments-ledger')) }
          : TREE;
      return { status: 200, text: async () => JSON.stringify(body) } as Response;
    });

    await request(await app()).get('/v1/buckets').expect(200);
    expect(urls.filter((u) => u.includes('/git/trees'))).toHaveLength(1);
  });

  it('re-reads on every request — the memoisation is per-request, not a cache', async () => {
    // THE load-bearing property. The design earns its "no TTL" claim by scoping
    // the memoisation to one request; make the source a module-level singleton
    // and every other test here still passes while the inventory silently
    // becomes permanently stale — the original bug in its worst form.
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url);
      const body = /blobs\/a{40}/.test(url)
        ? { encoding: 'base64', content: b64(fixture('dev', 'checkout-orders')) }
        : /blobs\/b{40}/.test(url)
          ? { encoding: 'base64', content: b64(fixture('prod', 'payments-ledger')) }
          : TREE;
      return { status: 200, text: async () => JSON.stringify(body) } as Response;
    });

    const built = await app();
    await request(built).get('/v1/buckets').expect(200);
    await request(built).get('/v1/buckets').expect(200);

    expect(urls.filter((u) => u.includes('/git/trees'))).toHaveLength(2);
    // The blobs, though, are content-addressed — the second request pays nothing
    // for them, which is the whole point of caching by SHA and not by clock.
    expect(urls.filter((u) => u.includes('/git/blobs/'))).toHaveLength(2);
  });

  it('refuses a 200 that is not a tree, rather than reading it as "no buckets"', async () => {
    // An empty body, a proxy interstitial, a change in the API's shape: filtering
    // a missing tree down to zero stacks would serve "the platform contains
    // nothing" — the original defect exactly.
    stubGitHub([{ match: /\/git\/trees\/main/, body: { message: 'something else' } }]);

    const res = await request(await app()).get('/v1/buckets').expect(502);
    expect(res.body.detail).toMatch(/did not have the expected shape/);
  });

  it('refuses a metadata.yaml that will not parse, and names the file', async () => {
    // Skipping it would be a partial inventory that looks complete; a bare throw
    // would be an undocumented 500 blaming the platform for a bad record.
    stubGitHub([
      { match: /\/git\/trees\/main/, body: TREE },
      { match: /\/git\/blobs\/a{40}/, body: { encoding: 'base64', content: b64('owning_team: checkout\n\tbad: [unclosed') } },
      { match: /\/git\/blobs\/b{40}/, body: { encoding: 'base64', content: b64(fixture('prod', 'payments-ledger')) } },
    ]);

    const res = await request(await app()).get('/v1/buckets').expect(502);
    expect(res.body.title).toBe('Upstream unavailable');
    expect(res.body.detail).toContain('idp-gitops/stacks/dev/checkout-orders/metadata.yaml');
  });

  it('reports an unreachable GitHub as 502, never as an empty inventory', async () => {
    stubGitHub([{ match: /\/git\/trees\/main/, status: 503, body: { message: 'Server Error' } }]);

    const res = await request(await app()).get('/v1/buckets').expect(502);
    expect(res.body).toMatchObject({ title: 'Upstream unavailable', status: 502 });
    expect(res.body.detail).toContain('Server Error');
    expect(res.body.buckets).toBeUndefined();
  });

  it("does not blame the caller for the platform's own rejected token", async () => {
    // /v1/buckets is an open operation — the credential in play is ours, so a
    // 401 here would send the caller to check a token they never sent.
    stubGitHub([{ match: /\/git\/trees\/main/, status: 401, body: { message: 'Bad credentials' } }]);

    const res = await request(await app()).get('/v1/buckets').expect(502);
    expect(res.body.detail).toContain('Bad credentials');
  });

  it('says what to set when the source is selected without a credential', async () => {
    delete process.env.GITHUB_TOKEN;

    const res = await request(await app()).get('/v1/buckets').expect(502);
    expect(res.body.detail).toContain('GITHUB_TOKEN is not set');
    expect(res.body.detail).toContain('IDP_INVENTORY=file');
  });

  it('still serves the routes that do not need the inventory', async () => {
    delete process.env.GITHUB_TOKEN;
    const built = await app();
    await request(built).get('/healthz').expect(200);
    await request(built).get('/v1/catalog/teams').expect(200);
  });
});
