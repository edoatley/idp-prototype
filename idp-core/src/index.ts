// The public surface of the domain. Every consumer (portal UI, HTTP API, CLI)
// imports from `idp-core` — never from a deep path — so the module layout stays
// free to change without touching the surfaces.

export { loadConfig, defaultPlatformDir, type PlatformConfig, type Team } from './config';
export { validate, type BucketRequest, type FieldError } from './validate';
export { generateRequestId, type RequestIdOptions } from './requestId';
export { generate, type GenerateContext, type GeneratedStack } from './generator';
export { listBuckets, defaultStacksDir, type BucketRecord } from './inventory';
export { makeGh, openBucketPR, openDecommissionPR, type GhContext, type OpenPrResult, type OpenPrParams, type DecommissionParams } from './github';
export { deliveryMetrics, type DeliveryMetrics, type GhReadParams, type RecentRequest } from './metrics';
export { compliance, type Compliance, type DriftItem } from './compliance';
