import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { listBuckets } from '../src/inventory';

const STACKS = path.join(__dirname, 'fixtures/stacks');

describe('listBuckets', () => {
  const buckets = listBuckets(STACKS);

  it('lists every stack with a metadata.yaml, sorted', () => {
    expect(buckets.map((b) => b.stackDir)).toEqual([
      'idp-gitops/stacks/dev/checkout-orders',
      'idp-gitops/stacks/dev/platform-demo',
    ]);
  });

  it('derives the bucket name and surfaces the inventory fields', () => {
    const checkout = buckets.find((b) => b.stackDir.endsWith('checkout-orders'))!;
    expect(checkout.bucketName).toBe('edo-dev-checkout-orders');
    expect(checkout.owning_team).toBe('checkout');
    expect(checkout.environment).toBe('dev');
    expect(checkout.request_id).toBe('req-20260831-checkout-orders-we67');
    expect(checkout.requester).toBe('edoatley');
    expect(checkout.created_at).toBe('2026-08-31');
  });

  it('returns [] when the stacks dir is absent', () => {
    expect(listBuckets(path.join(__dirname, 'fixtures/does-not-exist'))).toEqual([]);
  });
});
