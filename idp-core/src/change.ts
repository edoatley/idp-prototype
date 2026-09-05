import { generate, settingsOf } from './generator';
import type { BucketRequest } from './validate';
import type { BucketSettings } from './guardrails';
import type { BucketRecord } from './inventory';

// The single way anything changes in this platform.
//
// Every surface — the portal form, the HTTP API, the CLI — builds a ChangeRequest
// and hands it to a driver. Nothing else knows how a request becomes a reviewable
// change, so the branch names, titles and bodies are derived in exactly one place
// and a new surface cannot invent its own conventions.
//
// The driver is a port on purpose. Today's implementation opens a pull request;
// that is a mechanism, not the contract. Clients see a Request and its status.

export type Intent = 'create' | 'update' | 'delete';

/** A file the change writes. `content: null` deletes the path. */
export interface ChangeFile {
  path: string;
  content: string | null;
}

export interface ChangeTarget {
  stackDir: string;
  bucketName: string;
  environment: string;
  team: string;
}

export interface ChangeRequest {
  intent: Intent;
  requestId: string;
  target: ChangeTarget;
  files: ChangeFile[];
  title: string;
  body: string;
  branch: string;
}

export interface SubmittedChange {
  requestId: string;
  number: number;
  url: string;
}

export type RequestState =
  | 'pending_review'
  | 'blocked'
  | 'merged'
  | 'applied'
  | 'decommissioned'
  | 'failed'
  | 'cancelled';

export interface RequestStatus {
  requestId: string;
  intent: Intent;
  status: RequestState;
  bucketId: string;
  stackDir: string;
  submittedAt: string;
  message?: string;
  review: { url: string; number?: number };
}

export interface ChangeDriver {
  submit(change: ChangeRequest): Promise<SubmittedChange>;
  status(requestId: string): Promise<RequestStatus | null>;
  listOpen(): Promise<RequestStatus[]>;
}

// --- Plan builders ---------------------------------------------------------
// Pure: request -> ChangeRequest. No I/O, so what a change WOULD do is knowable
// without doing it — which is exactly what --dry-run shows a caller.

const STACK_FILES = ['main.tf', 'metadata.yaml'];

/** Branch names are namespaced by intent so a stack can be told apart at a glance. */
function branchFor(intent: Intent, target: ChangeTarget): string {
  const dir = target.stackDir.split('/').pop();
  return `idp/${intent}-${target.environment}-${dir}`;
}

function targetFor(req: BucketRequest): ChangeTarget {
  const dirName = `${req.owning_team}-${req.name}`;
  return {
    stackDir: `idp-gitops/stacks/${req.environment}/${dirName}`,
    bucketName: `edo-${req.environment}-${dirName}`.toLowerCase(),
    environment: req.environment,
    team: req.owning_team,
  };
}

function requestOf(record: BucketRecord, name: string): BucketRequest {
  return { name, owning_team: record.owning_team, environment: record.environment };
}

export interface CreateInput {
  request: BucketRequest;
  requester: string;
  requestId: string;
  date: string;
  settings?: Partial<BucketSettings>;
}

export function planCreate(input: CreateInput): ChangeRequest {
  const stack = generate(input.request, {
    requester: input.requester,
    requestId: input.requestId,
    date: input.date,
    settings: input.settings,
  });
  const target = targetFor(input.request);

  return {
    intent: 'create',
    requestId: input.requestId,
    target,
    files: Object.entries(stack.files).map(([name, content]) => ({ path: `${stack.stackDir}/${name}`, content })),
    title: `Provision bucket ${stack.bucketName}`,
    body: [
      `Requested via the IDP platform by @${input.requester}.`,
      '',
      `Stack: \`${stack.stackDir}\` · request-id \`${input.requestId}\`.`,
      '',
      'PR CI will plan + run the policy gate; merge to provision via WIF.',
    ].join('\n'),
    branch: branchFor('create', target),
  };
}

export interface UpdateInput {
  record: BucketRecord;
  name: string;
  settings: BucketSettings;
  requester: string;
  requestId: string;
  date: string;
}

/**
 * An update REGENERATES the stack from the record plus the new settings, rather
 * than patching the existing files. The generator stays the only thing that
 * writes Terraform, so a stack created a year ago and one updated today are
 * byte-identical for the same inputs — no drift between what the platform emits
 * and what is on disk.
 *
 * The original request_id, requester and creation date are provenance and are
 * carried through untouched; the request id of the CHANGE is separate.
 */
export function planUpdate(input: UpdateInput): ChangeRequest {
  const request = requestOf(input.record, input.name);
  const stack = generate(request, {
    requester: input.record.requester,
    requestId: input.record.request_id,
    date: input.record.created_at,
    settings: input.settings,
    update: { by: input.requester, date: input.date },
  });
  const target = targetFor(request);

  return {
    intent: 'update',
    requestId: input.requestId,
    target,
    files: Object.entries(stack.files).map(([name, content]) => ({ path: `${stack.stackDir}/${name}`, content })),
    title: `Update bucket ${stack.bucketName}`,
    body: [
      `Settings change requested via the IDP platform by @${input.requester}.`,
      '',
      `Stack: \`${stack.stackDir}\` · request-id \`${input.requestId}\`.`,
      '',
      describeSettings(input.settings),
      '',
      'PR CI will plan + re-run the policy gate; the plan should be an in-place update.',
    ].join('\n'),
    branch: branchFor('update', target),
  };
}

function describeSettings(settings: BucketSettings): string {
  const labels = Object.entries(settings.extraLabels);
  return [
    'Requested settings:',
    `- retention: ${settings.retentionDays === null ? 'keep all versions' : `expire noncurrent versions after ${settings.retentionDays} days`}`,
    `- storage class: ${settings.storageClass}`,
    `- extra labels: ${labels.length === 0 ? 'none' : labels.map(([k, v]) => `${k}=${v}`).join(', ')}`,
  ].join('\n');
}

export interface DeleteInput {
  record: BucketRecord;
  requester: string;
  requestId: string;
}

export function planDelete(input: DeleteInput): ChangeRequest {
  const { record } = input;
  const target: ChangeTarget = {
    stackDir: record.stackDir,
    bucketName: record.bucketName,
    environment: record.environment,
    team: record.owning_team,
  };

  return {
    intent: 'delete',
    requestId: input.requestId,
    target,
    files: STACK_FILES.map((f) => ({ path: `${record.stackDir}/${f}`, content: null })),
    title: `Decommission bucket ${record.bucketName}`,
    body: [
      `Decommission requested via the IDP platform by @${input.requester}.`,
      '',
      `Removes \`${record.stackDir}\` · request-id \`${input.requestId}\`.`,
      '',
      `Merging runs destroy.yml to tear down \`${record.bucketName}\`.`,
    ].join('\n'),
    branch: branchFor('delete', target),
  };
}

/** The settings a bucket will have once `patch` is applied to `current`. */
export function mergeSettings(current: BucketSettings, patch: Partial<BucketSettings>): BucketSettings {
  return {
    // An explicit null is a reset to the platform default; an absent key is "leave it".
    retentionDays: patch.retentionDays === undefined ? current.retentionDays : patch.retentionDays,
    storageClass: patch.storageClass ?? current.storageClass,
    extraLabels: patch.extraLabels ?? current.extraLabels,
  };
}

export { settingsOf };
