import { describe, it, expect } from 'vitest';
import { openBucketPR } from '../src/github';
import type { GeneratedStack } from '../src/generator';

const stack: GeneratedStack = {
  stackDir: 'idp-gitops/stacks/dev/checkout-orders',
  bucketName: 'edo-dev-checkout-orders',
  files: { 'main.tf': 'MAIN', 'metadata.yaml': 'META' },
};

// A fake fetch that records calls and returns canned responses keyed by method+path.
function makeFetch(handlers: Array<{ match: RegExp; method: string; status: number; body: unknown }>) {
  const calls: Array<{ method: string; url: string; body: unknown }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body ? JSON.parse(init.body as string) : undefined });
    const h = handlers.find((x) => x.method === method && x.match.test(url));
    if (!h) throw new Error(`unexpected ${method} ${url}`);
    return { status: h.status, text: async () => (h.body === undefined ? '' : JSON.stringify(h.body)) } as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('openBucketPR', () => {
  it('creates a single commit with both files and opens the PR', async () => {
    const { fetchImpl, calls } = makeFetch([
      { method: 'GET', match: /\/contents\//, status: 404, body: { message: 'Not Found' } },
      { method: 'GET', match: /\/git\/ref\/heads\/main/, status: 200, body: { object: { sha: 'BASE' } } },
      { method: 'GET', match: /\/git\/commits\/BASE/, status: 200, body: { tree: { sha: 'BASETREE' } } },
      { method: 'POST', match: /\/git\/trees/, status: 201, body: { sha: 'NEWTREE' } },
      { method: 'POST', match: /\/git\/commits/, status: 201, body: { sha: 'NEWCOMMIT' } },
      { method: 'POST', match: /\/git\/refs/, status: 201, body: {} },
      { method: 'POST', match: /\/pulls/, status: 201, body: { html_url: 'https://github.com/x/y/pull/42', number: 42 } },
    ]);

    const result = await openBucketPR({
      token: 't', owner: 'edoatley', repo: 'idp-prototype', branch: 'portal/dev-checkout-orders',
      stack, title: 'Provision bucket edo-dev-checkout-orders', body: 'b', fetchImpl,
    });

    expect(result).toEqual({ url: 'https://github.com/x/y/pull/42', number: 42 });

    const treeCall = calls.find((c) => c.url.includes('/git/trees'))!;
    const paths = (treeCall.body as { tree: Array<{ path: string; content: string }> }).tree;
    expect(paths.map((p) => p.path).sort()).toEqual([
      'idp-gitops/stacks/dev/checkout-orders/main.tf',
      'idp-gitops/stacks/dev/checkout-orders/metadata.yaml',
    ]);
    expect(paths.every((p) => p.content.length > 0)).toBe(true);

    const refCall = calls.find((c) => c.url.includes('/git/refs'))!;
    expect((refCall.body as { ref: string }).ref).toBe('refs/heads/portal/dev-checkout-orders');

    const prCall = calls.find((c) => c.url.endsWith('/pulls'))!;
    expect((prCall.body as { head: string; base: string }).head).toBe('portal/dev-checkout-orders');
    expect((prCall.body as { head: string; base: string }).base).toBe('main');
  });

  it('refuses when the stack directory already exists', async () => {
    const { fetchImpl } = makeFetch([
      { method: 'GET', match: /\/contents\//, status: 200, body: [{ name: 'main.tf' }] },
    ]);
    await expect(
      openBucketPR({ token: 't', owner: 'o', repo: 'r', branch: 'b', stack, title: 't', body: 'b', fetchImpl }),
    ).rejects.toThrow(/already exists/);
  });
});
