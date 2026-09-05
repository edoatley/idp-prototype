import { makeGh } from './github';

// Delivery metrics aggregated on demand from the GitHub API (read-only). No
// datastore. Pragmatic + explainable: apply success rate, lead time
// (PR created -> merged), and a recent-activity list. Assumptions are noted on
// the dashboard, not hidden.

export interface GhReadParams {
  token: string;
  owner: string;
  repo: string;
  fetchImpl?: typeof fetch;
}

export interface RecentRequest {
  number: number;
  title: string;
  createdAt: string;
  mergedAt: string | null;
  leadTimeMins: number | null;
  url: string;
}

export interface DeliveryMetrics {
  applyRuns: number;
  applySuccess: number;
  applySuccessRate: number | null; // null when there are no completed runs
  medianLeadTimeMins: number | null;
  recent: RecentRequest[];
}

// A "request" PR = one that provisions or decommissions a bucket. Portal PRs are
// titled "Provision bucket …" / "Decommission bucket …" or branch from portal/*.
function isRequestPR(pr: { title: string; head?: { ref?: string } }): boolean {
  return /^(Provision|Decommission) bucket/i.test(pr.title) || !!pr.head?.ref?.startsWith('portal/');
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

export async function deliveryMetrics(p: GhReadParams): Promise<DeliveryMetrics> {
  const gh = makeGh({ token: p.token, owner: p.owner, repo: p.repo, fetchImpl: p.fetchImpl ?? fetch });

  // apply.yml runs → success rate (a completed run == a provision/decommission apply).
  const runs = await gh<{ workflow_runs: Array<{ status: string; conclusion: string | null }> }>(
    'GET',
    '/actions/workflows/apply.yml/runs?per_page=100',
  );
  const completed = (runs.data.workflow_runs ?? []).filter((r) => r.status === 'completed');
  const applyRuns = completed.length;
  const applySuccess = completed.filter((r) => r.conclusion === 'success').length;
  const applySuccessRate = applyRuns > 0 ? applySuccess / applyRuns : null;

  // Merged request PRs → lead time (created → merged).
  const prs = await gh<Array<{ number: number; title: string; created_at: string; merged_at: string | null; html_url: string; head?: { ref?: string } }>>(
    'GET',
    '/pulls?state=closed&per_page=100&sort=updated&direction=desc',
  );
  const requests = (prs.data ?? [])
    .filter((pr) => pr.merged_at && isRequestPR(pr))
    .map<RecentRequest>((pr) => {
      const leadMs = new Date(pr.merged_at!).getTime() - new Date(pr.created_at).getTime();
      return {
        number: pr.number,
        title: pr.title,
        createdAt: pr.created_at,
        mergedAt: pr.merged_at,
        leadTimeMins: Math.max(0, Math.round(leadMs / 60000)),
        url: pr.html_url,
      };
    });

  const medianLeadTimeMins = median(requests.map((r) => r.leadTimeMins!).filter((n) => n != null));

  return {
    applyRuns,
    applySuccess,
    applySuccessRate,
    medianLeadTimeMins,
    recent: requests.slice(0, 8),
  };
}
