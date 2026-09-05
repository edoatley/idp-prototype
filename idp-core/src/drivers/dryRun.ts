import type { ChangeDriver, ChangeRequest, RequestStatus, SubmittedChange } from '../change';

// Renders a change without submitting it. Two jobs:
//   - `--dry-run` / `?dryRun=true`: show a caller the reviewable diff BEFORE
//     there is anything to review.
//   - tests: exercise the full plan-building path with no network at all.
//
// It records what it was asked to do so a test can assert on the change itself
// rather than on the HTTP calls a real submission would have made.

export class DryRunDriver implements ChangeDriver {
  readonly submitted: ChangeRequest[] = [];

  async submit(change: ChangeRequest): Promise<SubmittedChange> {
    this.submitted.push(change);
    return { requestId: change.requestId, number: 0, url: 'dry-run://not-submitted' };
  }

  async status(): Promise<RequestStatus | null> {
    return null;
  }

  async listOpen(): Promise<RequestStatus[]> {
    return [];
  }
}

/** The caller-facing summary of a change that was NOT submitted. */
export function dryRunResult(change: ChangeRequest) {
  const verb = { create: 'create', update: 'update', delete: 'remove' }[change.intent];
  return {
    intent: change.intent,
    bucketId: change.target.bucketName,
    stackDir: change.target.stackDir,
    summary: `${verb} ${change.target.stackDir} (${change.files.length} files)`,
    files: change.files.map((f) => ({ path: f.path, content: f.content })),
  };
}
