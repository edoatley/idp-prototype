import { createHash } from 'node:crypto';
import { GitHubError } from './github';

// Who is making a change.
//
// The platform holds no credentials and acts as the caller, so the caller's
// token already identifies them: asking them to ALSO declare who they are
// invites a lie and gets recorded in the inventory as fact. Resolving the login
// from the token makes attribution non-forgeable — you cannot record a change as
// someone else without holding their credential.

const USER_URL = 'https://api.github.com/user';

/**
 * Logins by token, so a burst of calls costs one lookup.
 *
 * Keyed by a hash of the token, never the token itself: a long-lived process
 * should not accumulate other people's credentials in memory just to memoise a
 * username.
 */
const cache = new Map<string, string>();

const keyFor = (token: string): string => createHash('sha256').update(token).digest('hex');

/** The GitHub login the token belongs to. */
export async function viewerLogin(token: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const key = keyFor(token);
  const cached = cache.get(key);
  if (cached) return cached;

  const res = await fetchImpl(USER_URL, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'idp-platform',
    },
  });

  const text = await res.text();
  const data = text ? (JSON.parse(text) as { login?: string; message?: string }) : {};
  if (res.status < 200 || res.status >= 300) {
    throw new GitHubError(res.status, data.message ?? 'could not identify the token', 'GET', '/user');
  }
  if (!data.login) {
    throw new GitHubError(res.status, 'GitHub returned no login for this token', 'GET', '/user');
  }

  cache.set(key, data.login);
  return data.login;
}

/** Test seam — the cache is process-wide and would otherwise leak between cases. */
export function clearIdentityCache(): void {
  cache.clear();
}
