import type { GeneratedStack } from './generator';

// Opens the bucket-request PR on the repo using the GitHub REST API over the
// built-in fetch (no SDK — avoids ESM/CJS friction and keeps deps minimal).
// Creates ONE commit (git data API: tree -> commit -> ref) on a new branch,
// then the PR. `fetchImpl` is injectable so tests run with no network.

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

export interface OpenPrResult {
  url: string;
  number: number;
}

export async function openBucketPR(params: OpenPrParams): Promise<OpenPrResult> {
  const { token, owner, repo, branch, stack, title, body } = params;
  const base = params.baseBranch ?? 'main';
  const doFetch = params.fetchImpl ?? fetch;
  const api = `https://api.github.com/repos/${owner}/${repo}`;

  async function gh<T>(method: string, path: string, payload?: unknown): Promise<{ status: number; data: T }> {
    const res = await doFetch(`${api}${path}`, {
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
  }

  // 1. Collision guard: refuse if the stack dir already exists on the base branch.
  const existing = await gh<unknown>('GET', `/contents/${stack.stackDir}?ref=${base}`);
  if (existing.status >= 200 && existing.status < 300) {
    throw new Error(`stack ${stack.stackDir} already exists — pick a different name.`);
  }
  if (existing.status !== 404) {
    throw new Error(`unexpected status ${existing.status} checking for an existing stack.`);
  }

  // 2. Base commit + tree.
  const ref = await gh<{ object: { sha: string } }>('GET', `/git/ref/heads/${base}`);
  const baseSha = ref.data.object.sha;
  const baseCommit = await gh<{ tree: { sha: string } }>('GET', `/git/commits/${baseSha}`);

  // 3. New tree with the generated files, then commit, then branch ref.
  const tree = await gh<{ sha: string }>('POST', '/git/trees', {
    base_tree: baseCommit.data.tree.sha,
    tree: Object.entries(stack.files).map(([name, content]) => ({
      path: `${stack.stackDir}/${name}`,
      mode: '100644',
      type: 'blob',
      content,
    })),
  });
  const commit = await gh<{ sha: string }>('POST', '/git/commits', {
    message: title,
    tree: tree.data.sha,
    parents: [baseSha],
  });
  await gh('POST', '/git/refs', { ref: `refs/heads/${branch}`, sha: commit.data.sha });

  // 4. The PR.
  const pr = await gh<{ html_url: string; number: number }>('POST', '/pulls', {
    title,
    head: branch,
    base,
    body,
  });
  return { url: pr.data.html_url, number: pr.data.number };
}
