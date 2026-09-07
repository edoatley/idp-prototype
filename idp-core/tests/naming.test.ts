import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config';
import { generate } from '../src/generator';
import { planCreate, planDelete } from '../src/change';
import { listBuckets } from '../src/inventory';
import { bucketNameFor } from '../src/naming';

// platform/config.yaml claims to be the single source of truth for the org
// prefix and region. It was not: the generator, the change layer and the
// inventory each carried their own copy of 'edo', so changing the config would
// have produced a platform that talked about buckets it had not provisioned.
// These tests are what make the claim true.

const ACME = path.join(__dirname, 'fixtures/platform-acme');
const naming = (dir: string) => {
  const cfg = loadConfig(dir);
  return { orgPrefix: cfg.orgPrefix, region: cfg.region };
};

const request = { name: 'orders', owning_team: 'checkout', environment: 'dev' };
const ctx = { requester: 'octocat', requestId: 'req-1', date: '2026-09-07' };

describe('naming follows platform config', () => {
  it('derives the bucket name from the configured org prefix', () => {
    const out = generate(request, { ...ctx, naming: naming(ACME) });
    expect(out.bucketName).toBe('acme-dev-checkout-orders');
    expect(out.files['main.tf']).toContain('region  = "europe-west1"');
  });

  it('reports the same name back through the change layer', () => {
    // The generator writing one name while the API reports another is the exact
    // failure a second copy of the rule invites.
    const change = planCreate({ request, requester: 'octocat', requestId: 'req-1', date: ctx.date, naming: naming(ACME) });
    const generated = generate(request, { ...ctx, naming: naming(ACME) });
    expect(change.target.bucketName).toBe(generated.bucketName);
    expect(change.title).toContain('acme-dev-checkout-orders');
  });

  it('reconstructs the same name when reading a stack back off disk', () => {
    const stacks = path.join(__dirname, 'fixtures/stacks');
    const [record] = listBuckets(stacks, 'acme');
    expect(record!.bucketName).toBe(bucketNameFor('acme', record!.environment, 'checkout', 'orders'));
  });

  it('still uses the repo\'s own conventions when none are supplied', () => {
    expect(generate(request, ctx).bucketName).toBe('edo-dev-checkout-orders');
  });

  it('names a decommission after the record, whatever the prefix', () => {
    const [record] = listBuckets(path.join(__dirname, 'fixtures/stacks'), 'acme');
    const change = planDelete({ record: record!, requester: 'octocat', requestId: 'req-2' });
    expect(change.title).toContain('acme-dev-checkout-orders');
  });
});
