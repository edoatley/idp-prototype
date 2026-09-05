// The public surface of the domain. Every consumer (portal UI, HTTP API, CLI)
// imports from `idp-core` — never from a deep path — so the module layout stays
// free to change without touching the surfaces.

export { loadConfig, defaultPlatformDir, type PlatformConfig, type Team } from './config';
export { validate, validateSettings, type BucketRequest, type FieldError } from './validate';
export { generateRequestId, type RequestIdOptions } from './requestId';
export { generate, settingsOf, type GenerateContext, type GeneratedStack } from './generator';
export { listBuckets, defaultStacksDir, type BucketRecord } from './inventory';
export { makeGh, type GhContext } from './github';
export { deliveryMetrics, type DeliveryMetrics, type GhReadParams, type RecentRequest } from './metrics';
export { compliance, type Compliance, type DriftItem } from './compliance';
export { GUARDRAILS, DEFAULT_SETTINGS, RESERVED_LABELS, type Guardrails, type BucketSettings } from './guardrails';
export {
  planCreate,
  planUpdate,
  planDelete,
  mergeSettings,
  type ChangeDriver,
  type ChangeRequest,
  type ChangeFile,
  type ChangeTarget,
  type CreateInput,
  type UpdateInput,
  type DeleteInput,
  type Intent,
  type RequestStatus,
  type RequestState,
  type SubmittedChange,
} from './change';
export { GitHubPrDriver, type GitHubDriverOptions } from './drivers/githubPr';
export { DryRunDriver, dryRunResult } from './drivers/dryRun';
