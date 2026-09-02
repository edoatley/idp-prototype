import type { GeneratedStack } from './generator';

// Opens PRs on the repo using the GitHub REST API over the built-in fetch (no
// SDK — avoids ESM/CJS friction and keeps deps minimal). Each helper creates ONE
// commit (git data API: tree -> commit -> ref) on a new branch, then the PR.
// `fetchImpl` is injectable so tests run with no network.

export interface OpenPrResult {
  url: string;
  number: number;
}

interface GhContext {
  token: string;
  owner: string;
  repo: string;
  fetchImpl: typeof fetch;
}

function makeGh({ token, owner, repo, fetchImpl }: GhContext) {
  const api = `https://api.github.com/repos/${owner}/${repo}`;
  return async function gh<T>(method: string, path: string, payload?: unknown): Promise<{ status: number; data: T }> {
    const res = await fetchImpl(`${api}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'content-type': 'application/json',
        'user-agent': 'idp-portal',
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const text = await res.text();
    const data = text ? (JSON.parse(text) as T) : ({} as T);
    return { status: res.status, data };
  };
}

// Create a branch carrying one commit built from `tree` entries, then open a PR.
type TreeEntry = { path: string; mode: '100644'; type: 'blob'; content?: string; sha?: string | null };

async function commitAndOpenPR(
  gh: ReturnType<typeof makeGh>,
  opts: { base: string; branch: string; title: string; body: string; tree: TreeEntry[] },
): Promise<OpenPrResult> {
  const ref = await gh<{ object: { sha: string } }>('GET', `/git/ref/heads/${opts.base}`);
  const baseSha = ref.data.object.sha;
  const baseCommit = await gh<{ tree: { sha: string } }>('GET', `/git/commits/${baseSha}`);

  const tree = await gh<{ sha: string }>('POST', '/git/trees', {
    base_tree: baseCommit.data.tree.sha,
    tree: opts.tree,
  });
  const commit = await gh<{ sha: string }>('POST', '/git/commits', {
    message: opts.title,
    tree: tree.data.sha,
    parents: [baseSha],
  });
  await gh('POST', '/git/refs', { ref: `refs/heads/${opts.branch}`, sha: commit.data.sha });

  const pr = await gh<{ html_url: string; number: number }>('POST', '/pulls', {
    title: opts.title,
    head: opts.branch,
    base: opts.base,
    body: opts.body,
  });
  return { url: pr.data.html_url, number: pr.data.number };
}

export interface OpenPrParams {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  stack: GeneratedStack;
  title: string;
  body: string;
  baseBranch?: string;
  fetchImpl?: typeof fetch;
}

export async function openBucketPR(params: OpenPrParams): Promise<OpenPrResult> {
  const base = params.baseBranch ?? 'main';
  const gh = makeGh({ token: params.token, owner: params.owner, repo: params.repo, fetchImpl: params.fetchImpl ?? fetch });

  // Collision guard: refuse if the stack dir already exists on the base branch.
  const existing = await gh<unknown>('GET', `/contents/${params.stack.stackDir}?ref=${base}`);
  if (existing.status >= 200 && existing.status < 300) {
    throw new Error(`stack ${params.stack.stackDir} already exists — pick a different name.`);
  }
  if (existing.status !== 404) {
    throw new Error(`unexpected status ${existing.status} checking for an existing stack.`);
  }

  const tree: TreeEntry[] = Object.entries(params.stack.files).map(([name, content]) => ({
    path: `${params.stack.stackDir}/${name}`,
    mode: '100644',
    type: 'blob',
    content,
  }));
  return commitAndOpenPR(gh, { base, branch: params.branch, title: params.title, body: params.body, tree });
}

export interface DecommissionParams {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  stackDir: string;
  files?: string[]; // files to remove; defaults to the standard stack files
  title: string;
  body: string;
  baseBranch?: string;
  fetchImpl?: typeof fetch;
}

// Opens a PR that REMOVES a stack dir (the GitOps-consistent delete). A tree
// entry with `sha: null` on top of base_tree deletes that path; destroy.yml then
// tears the resources down on merge.
export async function openDecommissionPR(params: DecommissionParams): Promise<OpenPrResult> {
  const base = params.baseBranch ?? 'main';
  const gh = makeGh({ token: params.token, owner: params.owner, repo: params.repo, fetchImpl: params.fetchImpl ?? fetch });
  const files = params.files ?? ['main.tf', 'metadata.yaml'];

  const tree: TreeEntry[] = files.map((f) => ({
    path: `${params.stackDir}/${f}`,
    mode: '100644',
    type: 'blob',
    sha: null,
  }));
  return commitAndOpenPR(gh, { base, branch: params.branch, title: params.title, body: params.body, tree });
}
