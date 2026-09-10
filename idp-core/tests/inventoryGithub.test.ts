import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';
import { GitHubInventory, clearInventoryCache } from '../src/inventory/github';
import { listBuckets } from '../src/inventory/file';
import { InventoryUnavailableError } from '../src/inventory/source';
import { makeFetch } from './fakeFetch';

// The GitHub-backed inventory, against a stubbed fetch — same seam and same
// style as drivers.test.ts, so this stays credential-free and offline.
//
// Every case here is a way the original defect could come back: a partial answer
// that looks complete, a cached answer that has gone stale, or a failure that
// degrades into an empty list instead of an error.

const STACKS = path.join(__dirname, 'fixtures/stacks');

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

// The blobs GitHub hands back are the very bytes the disk source reads, so the
// equivalence assertion below compares two readings of one file rather than two
// hand-written copies that could drift apart.
const fixture = (dir: string) => fs.readFileSync(path.join(STACKS, 'dev', dir, 'metadata.yaml'), 'utf8');
const ORDERS = fixture('checkout-orders');
const DEMO = fixture('platform-demo');

const TREE = {
  truncated: false,
  tree: [
    { path: 'README.md', type: 'blob', sha: 'r'.repeat(40) },
    { path: 'idp-gitops/stacks/dev', type: 'tree', sha: 't'.repeat(40) },
    { path: 'idp-gitops/stacks/dev/checkout-orders/main.tf', type: 'blob', sha: 'm'.repeat(40) },
    { path: 'idp-gitops/stacks/dev/checkout-orders/metadata.yaml', type: 'blob', sha: 'a'.repeat(40) },
    { path: 'idp-gitops/stacks/dev/platform-demo/metadata.yaml', type: 'blob', sha: 'b'.repeat(40) },
  ],
};

const BLOBS = [
  { match: /\/git\/blobs\/a{40}/, body: { encoding: 'base64', content: b64(ORDERS) } },
  { match: /\/git\/blobs\/b{40}/, body: { encoding: 'base64', content: b64(DEMO) } },
];

function inventory(handlers: Parameters<typeof makeFetch>[0]) {
  const { fetchImpl, calls } = makeFetch(handlers);
  return {
    inv: new GitHubInventory({ token: 't', owner: 'edoatley', repo: 'idp-prototype', fetchImpl }),
    calls,
  };
}

beforeEach(() => clearInventoryCache());

describe('GitHubInventory', () => {
  it('reads the base branch in one tree call and reports the same records as the disk source', async () => {
    const { inv, calls } = inventory([{ match: /\/git\/trees\/main\?recursive=1/, body: TREE }, ...BLOBS]);

    // Byte-identical to what a current checkout would report: both sources parse
    // through the same toRecord, so switching between them cannot change answers.
    expect(await inv.list()).toEqual(listBuckets(STACKS));
    expect(calls.filter((c) => c.url.includes('/git/trees'))).toHaveLength(1);
  });

  it('ignores everything that is not a stack record', async () => {
    const { inv, calls } = inventory([{ match: /\/git\/trees\/main/, body: TREE }, ...BLOBS]);
    await inv.list();
    // main.tf, README.md and the directory entry are never fetched — an unmatched
    // request throws in the fake, so a stray fetch would fail this outright.
    expect(calls.filter((c) => c.url.includes('/git/blobs/'))).toHaveLength(2);
  });

  it('reads the inventory once per instance, however often it is asked', async () => {
    const { inv, calls } = inventory([{ match: /\/git\/trees\/main/, body: TREE }, ...BLOBS]);
    await Promise.all([inv.list(), inv.list()]);
    await inv.list();
    // One instance is one request; the create path lists twice within it.
    expect(calls.filter((c) => c.url.includes('/git/trees'))).toHaveLength(1);
  });

  it('fetches a blob only on first sight of its SHA', async () => {
    const first = inventory([{ match: /\/git\/trees\/main/, body: TREE }, ...BLOBS]);
    await first.inv.list();

    // No blob handlers at all: the fake throws on any unmatched request, so this
    // passes only if the content-addressed cache serves both records.
    const second = inventory([{ match: /\/git\/trees\/main/, body: TREE }]);
    expect(await second.inv.list()).toEqual(await first.inv.list());
    expect(second.calls.filter((c) => c.url.includes('/git/blobs/'))).toHaveLength(0);
  });

  it('re-fetches when a record changes, because the SHA changes with it', async () => {
    const before = inventory([{ match: /\/git\/trees\/main/, body: TREE }, ...BLOBS]);
    await before.inv.list();

    const edited = ORDERS.replace('requester: edoatley', 'requester: mei-lin');
    const nextTree = {
      truncated: false,
      tree: TREE.tree.map((e) => (e.sha === 'a'.repeat(40) ? { ...e, sha: 'c'.repeat(40) } : e)),
    };
    const after = inventory([
      { match: /\/git\/trees\/main/, body: nextTree },
      { match: /\/git\/blobs\/c{40}/, body: { encoding: 'base64', content: b64(edited) } },
    ]);

    const records = await after.inv.list();
    expect(records.find((r) => r.stackDir.endsWith('checkout-orders'))!.requester).toBe('mei-lin');
  });

  it('raises on a truncated tree rather than returning a partial inventory', async () => {
    const { inv } = inventory([{ match: /\/git\/trees\/main/, body: { ...TREE, truncated: true } }, ...BLOBS]);
    // The dangerous case: a short list that looks like the whole truth.
    await expect(inv.list()).rejects.toBeInstanceOf(InventoryUnavailableError);
    await expect(inv.list()).rejects.toThrow(/truncated/);
  });

  it('raises on a 200 that is not a tree, rather than reading it as an empty repo', async () => {
    // `truncated` being absent is not `truncated: false`. An empty body, a proxy
    // interstitial, or a change in the API's shape must not filter down to zero
    // stacks and be served as "the platform contains nothing".
    const { inv } = inventory([{ match: /\/git\/trees\/main/, body: { message: 'something else' } }]);
    await expect(inv.list()).rejects.toBeInstanceOf(InventoryUnavailableError);
    await expect(inv.list()).rejects.toThrow(/expected shape/);
  });

  it('raises when a record will not parse, naming the file', async () => {
    // Skipping the bad record would be a partial inventory that looks complete;
    // letting the YAML error escape would blame the platform for a bad file.
    const { inv } = inventory([
      { match: /\/git\/trees\/main/, body: TREE },
      { match: /\/git\/blobs\/a{40}/, body: { encoding: 'base64', content: b64('owning_team: checkout\n\tbad: [unclosed') } },
      ...BLOBS.slice(1),
    ]);
    const err = await inv.list().catch((e) => e);
    expect(err).toBeInstanceOf(InventoryUnavailableError);
    expect(err.message).toContain('idp-gitops/stacks/dev/checkout-orders/metadata.yaml');
  });

  it('raises when GitHub is unreachable — never an empty list', async () => {
    const { inv } = inventory([{ match: /\/git\/trees\/main/, status: 503, body: { message: 'Server Error' } }]);
    const err = await inv.list().catch((e) => e);
    expect(err).toBeInstanceOf(InventoryUnavailableError);
    expect(err.message).toContain('Server Error');
  });

  it('does not report the platform\'s own rejected token as the caller\'s problem', async () => {
    const { inv } = inventory([{ match: /\/git\/trees\/main/, status: 401, body: { message: 'Bad credentials' } }]);
    const err = await inv.list().catch((e) => e);
    // A GitHubError would be translated to a 401 at the HTTP edge, telling
    // whoever asked to go and check a credential that is not theirs.
    expect(err).toBeInstanceOf(InventoryUnavailableError);
    expect(err.message).toContain('Bad credentials');
  });

  it('does not remember a failed read as the answer to the next one', async () => {
    const { inv } = inventory([{ match: /\/git\/trees\/main/, status: 503, body: { message: 'Server Error' } }]);
    await expect(inv.list()).rejects.toBeInstanceOf(InventoryUnavailableError);
    await expect(inv.list()).rejects.toBeInstanceOf(InventoryUnavailableError);
  });

  it('raises when a blob comes back in an encoding it cannot read', async () => {
    const { inv } = inventory([
      { match: /\/git\/trees\/main/, body: TREE },
      { match: /\/git\/blobs\/a{40}/, body: { encoding: 'none', size: 120000000 } },
      ...BLOBS.slice(1),
    ]);
    await expect(inv.list()).rejects.toThrow(/cannot be read/);
  });
});
