import { makeGh } from '../github';
import type { ChangeDriver, ChangeRequest, RequestStatus, RequestState, SubmittedChange, Intent } from '../change';

// The GitOps driver: a change request becomes ONE commit on a new branch, then a
// pull request. Adds, edits and deletions all travel in the same tree, so a
// create and a decommission are the same code path with different entries —
// this is what collapsed the portal's two bespoke PR helpers into one.
//
// Status is resolved live from the repo rather than stored. There is no request
// database to fall out of sync: if the PR says merged and the apply comment says
// applied, the bucket is applied. That is the whole mechanism.

export interface GitHubDriverOptions {
  token: string;
  owner: string;
  repo: string;
  baseBranch?: string;
  fetchImpl?: typeof fetch;
}

type TreeEntry = { path: string; mode: '100644'; type: 'blob'; content?: string; sha?: string | null };

// The sticky-comment markers the workflows already write on the originating PR.
// Reusing them means status needs no new plumbing in CI — the audit trail the
// pipelines post for humans doubles as the machine-readable outcome.
const APPLY_MARKER = /<!-- tf-apply:(.+?) -->/;
const DESTROY_MARKER = /<!-- tf-destroy:(.+?) -->/;
// The reports write their outcome as a heading: `### ❌ Apply failed — \`stack\``.
const FAILED = /^#{1,6}\s*❌/m;

export class GitHubPrDriver implements ChangeDriver {
  private readonly gh: ReturnType<typeof makeGh>;
  private readonly base: string;

  constructor(private readonly opts: GitHubDriverOptions) {
    this.gh = makeGh({
      token: opts.token,
      owner: opts.owner,
      repo: opts.repo,
      fetchImpl: opts.fetchImpl ?? fetch,
    });
    this.base = opts.baseBranch ?? 'main';
  }

  async submit(change: ChangeRequest): Promise<SubmittedChange> {
    if (change.intent === 'create') await this.refuseIfStackExists(change.target.stackDir);

    const ref = await this.gh<{ object: { sha: string } }>('GET', `/git/ref/heads/${this.base}`);
    const baseSha = ref.data.object.sha;
    const baseCommit = await this.gh<{ tree: { sha: string } }>('GET', `/git/commits/${baseSha}`);

    const tree: TreeEntry[] = change.files.map((f) =>
      f.content === null
        ? { path: f.path, mode: '100644', type: 'blob', sha: null }
        : { path: f.path, mode: '100644', type: 'blob', content: f.content },
    );

    const newTree = await this.gh<{ sha: string }>('POST', '/git/trees', {
      base_tree: baseCommit.data.tree.sha,
      tree,
    });
    const commit = await this.gh<{ sha: string }>('POST', '/git/commits', {
      message: change.title,
      tree: newTree.data.sha,
      parents: [baseSha],
    });
    await this.gh('POST', '/git/refs', { ref: `refs/heads/${change.branch}`, sha: commit.data.sha });

    const pr = await this.gh<{ html_url: string; number: number }>('POST', '/pulls', {
      title: change.title,
      head: change.branch,
      base: this.base,
      body: change.body,
    });

    return { requestId: change.requestId, number: pr.data.number, url: pr.data.html_url };
  }

  /**
   * Refuse to create a stack that is already declared. Without this the change
   * would open cleanly and only fail at apply, after a human had reviewed it.
   */
  private async refuseIfStackExists(stackDir: string): Promise<void> {
    const existing = await this.gh<unknown>('GET', `/contents/${stackDir}?ref=${this.base}`);
    if (existing.status >= 200 && existing.status < 300) {
      throw new Error(`stack ${stackDir} already exists — pick a different name.`);
    }
    if (existing.status !== 404) {
      throw new Error(`unexpected status ${existing.status} checking for an existing stack.`);
    }
  }

  async status(requestId: string): Promise<RequestStatus | null> {
    const pr = await this.findPr(requestId);
    return pr ? this.statusOf(pr) : null;
  }

  async listOpen(): Promise<RequestStatus[]> {
    const prs = await this.gh<PullRequest[]>('GET', '/pulls?state=open&per_page=100');
    const requests = (prs.data ?? []).filter((pr) => requestIdOf(pr.body) !== null);
    return Promise.all(requests.map((pr) => this.statusOf(pr)));
  }

  private async findPr(requestId: string): Promise<PullRequest | null> {
    // Open PRs first (the common case for anything still in flight), then recently
    // closed ones so a finished request stays answerable.
    for (const state of ['open', 'closed']) {
      const prs = await this.gh<PullRequest[]>(
        'GET',
        `/pulls?state=${state}&per_page=100&sort=updated&direction=desc`,
      );
      const match = (prs.data ?? []).find((pr) => requestIdOf(pr.body) === requestId);
      if (match) return match;
    }
    return null;
  }

  private async statusOf(pr: PullRequest): Promise<RequestStatus> {
    const requestId = requestIdOf(pr.body)!;
    const intent = intentOf(pr.title);
    const stackDir = stackDirOf(pr.body) ?? '';
    const bucketId = bucketIdOf(pr.title) ?? '';

    const { status, message } = await this.resolveState(pr, intent);

    return {
      requestId,
      intent,
      status,
      bucketId,
      stackDir,
      submittedAt: pr.created_at,
      ...(message ? { message } : {}),
      review: { url: pr.html_url, number: pr.number },
    };
  }

  private async resolveState(pr: PullRequest, intent: Intent): Promise<{ status: RequestState; message?: string }> {
    if (pr.state === 'open') {
      // The gate's verdict is the PR check run outcome; pr.yml fails when the
      // policy gate denies, so a failing check means "fix it", not "review it".
      const checks = await this.gh<{ check_runs: Array<{ conclusion: string | null; name: string }> }>(
        'GET',
        `/commits/${pr.head.sha}/check-runs?per_page=100`,
      );
      const runs = checks.data.check_runs ?? [];
      const failed = runs.filter((r) => r.conclusion === 'failure' || r.conclusion === 'timed_out');
      if (failed.length) {
        return {
          status: 'blocked',
          message: `Checks failed: ${failed.map((r) => r.name).join(', ')}. See the plan comment for the gate's objection.`,
        };
      }
      return { status: 'pending_review' };
    }

    if (!pr.merged_at) {
      return { status: 'cancelled', message: 'Closed without merging; nothing changed.' };
    }

    // Merged: the apply/destroy workflow posts its outcome back onto this PR.
    const comments = await this.gh<Array<{ body: string }>>('GET', `/issues/${pr.number}/comments?per_page=100`);
    const marker = intent === 'delete' ? DESTROY_MARKER : APPLY_MARKER;
    const report = (comments.data ?? []).find((c) => marker.test(c.body ?? ''));

    if (!report) {
      return { status: 'merged', message: 'Merged; provisioning has not reported yet.' };
    }
    if (FAILED.test(report.body)) {
      return { status: 'failed', message: firstLine(report.body) };
    }
    return { status: intent === 'delete' ? 'decommissioned' : 'applied' };
  }
}

interface PullRequest {
  number: number;
  title: string;
  body: string | null;
  state: string;
  created_at: string;
  merged_at: string | null;
  html_url: string;
  head: { sha: string; ref?: string };
}

// The PR body is the carrier for a request's identity. It is written by
// change.ts and only ever read back here.
export function requestIdOf(body: string | null): string | null {
  const m = /request-id `([a-z0-9_-]+)`/.exec(body ?? '');
  return m ? m[1]! : null;
}

function stackDirOf(body: string | null): string | null {
  const m = /`(idp-gitops\/stacks\/[^`]+)`/.exec(body ?? '');
  return m ? m[1]! : null;
}

function bucketIdOf(title: string): string | null {
  const m = /^(?:Provision|Update|Decommission) bucket (\S+)/i.exec(title);
  return m ? m[1]! : null;
}

function intentOf(title: string): Intent {
  if (/^Decommission bucket/i.test(title)) return 'delete';
  if (/^Update bucket/i.test(title)) return 'update';
  return 'create';
}

function firstLine(body: string): string {
  return (
    body
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.startsWith('###'))
      ?.replace(/^#+\s*/, '') ?? 'Provisioning failed — see the run for details.'
  );
}
