import { makeGh } from './github';
import type { GhReadParams } from './metrics';

// Compliance/drift status aggregated on demand (read-only):
//   - current drift: open `Drift:` Issues opened by drift.yml
//   - policy status: recent pr.yml run conclusions as a pass-rate (the policy
//     gate is part of that run, so a failed gate fails the run — a fair proxy).

export interface DriftItem {
  stack: string;
  issueNumber: number;
  url: string;
}

export interface Compliance {
  openDrift: DriftItem[];
  policyRuns: number;
  policyPass: number;
  policyPassRate: number | null;
}

export async function compliance(p: GhReadParams): Promise<Compliance> {
  const gh = makeGh({ token: p.token, owner: p.owner, repo: p.repo, fetchImpl: p.fetchImpl ?? fetch });

  // Open Drift issues. /issues includes PRs, so exclude anything with pull_request.
  const issues = await gh<Array<{ number: number; title: string; html_url: string; pull_request?: unknown }>>(
    'GET',
    '/issues?state=open&per_page=100',
  );
  const openDrift = (issues.data ?? [])
    .filter((i) => !i.pull_request && /^Drift:/.test(i.title))
    .map<DriftItem>((i) => ({
      stack: i.title.replace(/^Drift:\s*/, '').trim(),
      issueNumber: i.number,
      url: i.html_url,
    }));

  // pr.yml runs → policy pass-rate proxy.
  const runs = await gh<{ workflow_runs: Array<{ status: string; conclusion: string | null }> }>(
    'GET',
    '/actions/workflows/pr.yml/runs?per_page=100',
  );
  const completed = (runs.data.workflow_runs ?? []).filter((r) => r.status === 'completed');
  const policyRuns = completed.length;
  const policyPass = completed.filter((r) => r.conclusion === 'success').length;
  const policyPassRate = policyRuns > 0 ? policyPass / policyRuns : null;

  return { openDrift, policyRuns, policyPass, policyPassRate };
}
