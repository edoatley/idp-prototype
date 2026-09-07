// The shared GitHub REST client, over the built-in fetch (no SDK — avoids
// ESM/CJS friction and keeps deps minimal). `fetchImpl` is injectable so every
// consumer can be tested with no network.
//
// The commit/PR mechanics that used to live here now belong to
// drivers/githubPr.ts, so there is one implementation of "how a change is
// submitted" rather than one per intent.

/**
 * A non-2xx response from GitHub, carrying GitHub's own explanation.
 *
 * This exists because the alternative is worse than an exception: a caller that
 * reads `data` without checking `status` treats an error body as a payload, and
 * `{"message":"Bad credentials"}` becomes `data.filter is not a function` three
 * frames later. An expired token then looks like a platform bug rather than a
 * credential problem. Failing here keeps the cause attached to the effect.
 */
export class GitHubError extends Error {
  constructor(
    readonly status: number,
    readonly githubMessage: string,
    readonly method: string,
    readonly path: string,
  ) {
    super(`GitHub returned ${status} for ${method} ${path}: ${githubMessage}`);
    this.name = 'GitHubError';
  }
}

export interface GhContext {
  token: string;
  owner: string;
  repo: string;
  fetchImpl: typeof fetch;
}

/** Statuses a specific call expects and will interpret itself. */
export interface GhOptions {
  allow?: number[];
}

// Exported for reuse by the read-only aggregation modules (metrics, compliance).
export function makeGh({ token, owner, repo, fetchImpl }: GhContext) {
  const api = `https://api.github.com/repos/${owner}/${repo}`;
  return async function gh<T>(
    method: string,
    path: string,
    payload?: unknown,
    opts: GhOptions = {},
  ): Promise<{ status: number; data: T }> {
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
    // Success is derived from the status code, not `res.ok`: the injected fakes
    // in tests implement only what the client actually needs, and a client that
    // silently depends on more of the Response shape than it reads is a trap.
    const ok = res.status >= 200 && res.status < 300;

    // A non-JSON body (an HTML error page from a proxy, say) must not turn into
    // a SyntaxError that hides the status that actually explains the failure.
    let data: T;
    try {
      data = text ? (JSON.parse(text) as T) : ({} as T);
    } catch {
      if (ok) throw new GitHubError(res.status, 'response was not JSON', method, path);
      data = {} as T;
    }

    const expected = ok || (opts.allow ?? []).includes(res.status);
    if (!expected) {
      const message = (data as { message?: string })?.message ?? text.slice(0, 200) ?? 'no message';
      throw new GitHubError(res.status, message, method, path);
    }

    return { status: res.status, data };
  };
}
