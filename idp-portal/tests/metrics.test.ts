import { describe, it, expect } from 'vitest';
import { deliveryMetrics } from '../src/metrics';
import { makeFetch } from './fakeFetch';

const P = { token: 't', owner: 'o', repo: 'r' };

describe('deliveryMetrics', () => {
  it('computes apply success rate, median lead time and recent requests', async () => {
    const { fetchImpl } = makeFetch([
      {
        match: /actions\/workflows\/apply\.yml\/runs/,
        body: {
          workflow_runs: [
            { status: 'completed', conclusion: 'success' },
            { status: 'completed', conclusion: 'success' },
            { status: 'completed', conclusion: 'failure' },
            { status: 'in_progress', conclusion: null }, // ignored (not completed)
          ],
        },
      },
      {
        match: /\/pulls\?/,
        body: [
          // 60-min lead time, request PR (title)
          { number: 31, title: 'Provision bucket edo-dev-search-index', created_at: '2026-09-02T10:00:00Z', merged_at: '2026-09-02T11:00:00Z', html_url: 'u31', head: { ref: 'portal/dev-search-index' } },
          // 30-min lead time, request PR (branch)
          { number: 30, title: 'Decommission bucket edo-dev-checkout-orders', created_at: '2026-09-02T09:00:00Z', merged_at: '2026-09-02T09:30:00Z', html_url: 'u30', head: { ref: 'portal/decommission-dev-checkout-orders' } },
          // not a request PR -> excluded
          { number: 16, title: 'Update CLAUDE.md', created_at: '2026-09-01T00:00:00Z', merged_at: '2026-09-01T00:10:00Z', html_url: 'u16', head: { ref: 'docs/x' } },
          // request PR but not merged -> excluded
          { number: 99, title: 'Provision bucket edo-dev-open', created_at: '2026-09-02T12:00:00Z', merged_at: null, html_url: 'u99', head: { ref: 'portal/dev-open' } },
        ],
      },
    ]);

    const m = await deliveryMetrics({ ...P, fetchImpl });
    expect(m.applyRuns).toBe(3);
    expect(m.applySuccess).toBe(2);
    expect(m.applySuccessRate).toBeCloseTo(2 / 3);
    expect(m.medianLeadTimeMins).toBe(45); // median of [30, 60]
    expect(m.recent.map((r) => r.number)).toEqual([31, 30]);
    expect(m.recent[0]!.leadTimeMins).toBe(60);
  });

  it('returns nulls when there is no data', async () => {
    const { fetchImpl } = makeFetch([
      { match: /apply\.yml\/runs/, body: { workflow_runs: [] } },
      { match: /\/pulls\?/, body: [] },
    ]);
    const m = await deliveryMetrics({ ...P, fetchImpl });
    expect(m.applySuccessRate).toBeNull();
    expect(m.medianLeadTimeMins).toBeNull();
    expect(m.recent).toEqual([]);
  });
});
