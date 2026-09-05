import type { Request } from 'express';
import { unauthorized } from './problem';

// The service holds no credentials. A caller presents its own GitHub token and
// the platform acts as that caller, so authorization is whatever GitHub already
// grants them on the GitOps repo and every change is attributed to a real
// identity. Nothing to rotate, nothing to leak, and the audit trail is honest.

export function bearerToken(req: Request): string | null {
  const header = req.get('authorization') ?? '';
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match ? match[1]! : null;
}

export function requireToken(req: Request): string {
  const token = bearerToken(req);
  if (!token) {
    throw unauthorized('Supply a GitHub token as `Authorization: Bearer <token>`.');
  }
  return token;
}

export function repoFromEnv(): { owner: string; repo: string } {
  const [owner, repo] = (process.env.GITHUB_REPO ?? '').split('/');
  if (!owner || !repo) {
    throw new Error('GITHUB_REPO must be set to <owner>/<repo>.');
  }
  return { owner, repo };
}
