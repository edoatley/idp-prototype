import { describe, it, expect, beforeEach } from 'vitest';
import { viewerLogin, clearIdentityCache } from '../src/identity';
import { GitHubError } from '../src/github';

// Attribution is derived from the credential so it cannot be forged. These pin
// the two properties that matter: it asks GitHub, and it does not ask twice.

function fakeUser(responses: Array<{ status: number; body: unknown }>) {
  const calls: string[] = [];
  let i = 0;
  const fetchImpl = (async (url: string) => {
    calls.push(url);
    const r = responses[Math.min(i++, responses.length - 1)]!;
    return { status: r.status, text: async () => JSON.stringify(r.body) } as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

beforeEach(() => clearIdentityCache());

describe('viewerLogin', () => {
  it('resolves the login the token belongs to', async () => {
    const { fetchImpl, calls } = fakeUser([{ status: 200, body: { login: 'ada-okafor' } }]);
    expect(await viewerLogin('tok', fetchImpl)).toBe('ada-okafor');
    expect(calls[0]).toBe('https://api.github.com/user');
  });

  it('asks once per token, so a burst of writes costs one lookup', async () => {
    const { fetchImpl, calls } = fakeUser([{ status: 200, body: { login: 'ada-okafor' } }]);
    await viewerLogin('tok', fetchImpl);
    await viewerLogin('tok', fetchImpl);
    await viewerLogin('tok', fetchImpl);
    expect(calls).toHaveLength(1);
  });

  it('does not confuse one token with another', async () => {
    const { fetchImpl } = fakeUser([
      { status: 200, body: { login: 'ada-okafor' } },
      { status: 200, body: { login: 'ravi-menon' } },
    ]);
    expect(await viewerLogin('tok-a', fetchImpl)).toBe('ada-okafor');
    expect(await viewerLogin('tok-b', fetchImpl)).toBe('ravi-menon');
  });

  it('raises a GitHubError a rejected token can be reported from', async () => {
    const { fetchImpl } = fakeUser([{ status: 401, body: { message: 'Bad credentials' } }]);
    const err = await viewerLogin('bad', fetchImpl).catch((e) => e);
    expect(err).toBeInstanceOf(GitHubError);
    expect(err.status).toBe(401);
  });

  it('does not cache a failure', async () => {
    const { fetchImpl, calls } = fakeUser([
      { status: 401, body: { message: 'Bad credentials' } },
      { status: 200, body: { login: 'ada-okafor' } },
    ]);
    await expect(viewerLogin('tok', fetchImpl)).rejects.toBeInstanceOf(GitHubError);
    expect(await viewerLogin('tok', fetchImpl)).toBe('ada-okafor');
    expect(calls).toHaveLength(2);
  });
});
