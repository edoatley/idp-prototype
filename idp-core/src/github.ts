// The shared GitHub REST client, over the built-in fetch (no SDK — avoids
// ESM/CJS friction and keeps deps minimal). `fetchImpl` is injectable so every
// consumer can be tested with no network.
//
// The commit/PR mechanics that used to live here now belong to
// drivers/githubPr.ts, so there is one implementation of "how a change is
// submitted" rather than one per intent.

export interface GhContext {
  token: string;
  owner: string;
  repo: string;
  fetchImpl: typeof fetch;
}

// Exported for reuse by the read-only aggregation modules (metrics, compliance).
export function makeGh({ token, owner, repo, fetchImpl }: GhContext) {
  const api = `https://api.github.com/repos/${owner}/${repo}`;
  return async function gh<T>(method: string, path: string, payload?: unknown): Promise<{ status: number; data: T }> {
    const res = await fetchImpl(`${api}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'content-type': 'application/json',
        'user-agent': 'idp-platform',
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const text = await res.text();
    const data = text ? (JSON.parse(text) as T) : ({} as T);
    return { status: res.status, data };
  };
}
