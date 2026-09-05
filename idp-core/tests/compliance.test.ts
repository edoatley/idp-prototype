import { describe, it, expect } from 'vitest';
import { compliance } from '../src/compliance';
import { makeFetch } from './fakeFetch';

const P = { token: 't', owner: 'o', repo: 'r' };

describe('compliance', () => {
  it('lists open Drift issues (excluding PRs/other issues) and computes policy pass-rate', async () => {
    const { fetchImpl } = makeFetch([
      {
        match: /\/issues\?/,
        body: [
          { number: 28, title: 'Drift: idp-gitops/stacks/dev/platform-demo', html_url: 'i28' },
          { number: 40, title: 'Some feature request', html_url: 'i40' }, // not drift
          { number: 41, title: 'Drift: idp-gitops/stacks/dev/other', html_url: 'i41', pull_request: { url: 'x' } }, // a PR, excluded
        ],
      },
      {
        match: /pr\.yml\/runs/,
        body: {
          workflow_runs: [
            { status: 'completed', conclusion: 'success' },
            { status: 'completed', conclusion: 'failure' }, // e.g. the blocked non-compliant PR
            { status: 'completed', conclusion: 'success' },
            { status: 'queued', conclusion: null }, // ignored
          ],
        },
      },
    ]);

    const c = await compliance({ ...P, fetchImpl });
    expect(c.openDrift).toEqual([
      { stack: 'idp-gitops/stacks/dev/platform-demo', issueNumber: 28, url: 'i28' },
    ]);
    expect(c.policyRuns).toBe(3);
    expect(c.policyPass).toBe(2);
    expect(c.policyPassRate).toBeCloseTo(2 / 3);
  });

  it('handles no drift and no runs', async () => {
    const { fetchImpl } = makeFetch([
      { match: /\/issues\?/, body: [] },
      { match: /pr\.yml\/runs/, body: { workflow_runs: [] } },
    ]);
    const c = await compliance({ ...P, fetchImpl });
    expect(c.openDrift).toEqual([]);
    expect(c.policyPassRate).toBeNull();
  });
});
