import type { PlatformConfig } from './config';
import { RESERVED_LABELS, type BucketSettings } from './guardrails';

// Mirror the module's input validation (idp-gitops/modules/gcs-bucket/variables.tf)
// so the portal rejects bad requests before generating anything. The module and
// the policy gate remain the authoritative checks; this is a fast fail-early.

export interface BucketRequest {
  name: string;
  owning_team: string;
  environment: string;
}

export interface FieldError {
  field: string;
  message: string;
}

// 3–30 chars, lowercase letters/digits/hyphens, start and end alphanumeric.
const NAME_RE = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;

export function validate(req: BucketRequest, config: PlatformConfig): FieldError[] {
  const errors: FieldError[] = [];

  if (!NAME_RE.test(req.name)) {
    errors.push({
      field: 'name',
      message: 'name must be 3–30 chars: lowercase letters, digits or hyphens, starting and ending alphanumeric.',
    });
  }

  if (!config.environments.includes(req.environment)) {
    errors.push({
      field: 'environment',
      message: `environment must be one of: ${config.environments.join(', ')}.`,
    });
  }

  if (!config.teams.some((t) => t.id === req.owning_team)) {
    errors.push({
      field: 'owning_team',
      message: `owning_team must be a known team: ${config.teams.map((t) => t.id).join(', ')}.`,
    });
  }

  return errors;
}

// Settings validation mirrors the module's variable validation, for the same
// fail-early reason. It is not redundant with the API's schema check: OpenAPI
// can describe the charset and the range, but "must not be one of the platform's
// reserved labels" is a platform rule, not a shape — and it has to hold for every
// caller, not just HTTP ones.

const LABEL_KEY_RE = /^[a-z][a-z0-9_-]{0,62}$/;
const LABEL_VALUE_RE = /^[a-z0-9_-]{0,63}$/;
const STORAGE_CLASSES = ['STANDARD', 'NEARLINE'];
const MAX_EXTRA_LABELS = 8;

export function validateSettings(settings: Partial<BucketSettings> | undefined): FieldError[] {
  if (!settings) return [];
  const errors: FieldError[] = [];

  const { retentionDays } = settings;
  if (retentionDays !== undefined && retentionDays !== null) {
    if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
      errors.push({ field: 'retentionDays', message: 'retentionDays must be a whole number of days between 1 and 3650, or null.' });
    }
  }

  if (settings.storageClass !== undefined && !STORAGE_CLASSES.includes(settings.storageClass)) {
    errors.push({ field: 'storageClass', message: `storageClass must be one of: ${STORAGE_CLASSES.join(', ')}.` });
  }

  const labels = settings.extraLabels;
  if (labels !== undefined) {
    const keys = Object.keys(labels);
    if (keys.length > MAX_EXTRA_LABELS) {
      errors.push({ field: 'extraLabels', message: `extraLabels is capped at ${MAX_EXTRA_LABELS} labels.` });
    }
    const reserved = keys.filter((k) => (RESERVED_LABELS as readonly string[]).includes(k));
    if (reserved.length) {
      errors.push({
        field: 'extraLabels',
        message: `extraLabels must not set the platform's own labels: ${reserved.join(', ')}.`,
      });
    }
    for (const [k, v] of Object.entries(labels)) {
      if (!LABEL_KEY_RE.test(k) || !LABEL_VALUE_RE.test(v)) {
        errors.push({
          field: 'extraLabels',
          message: `label ${k}: keys must start with a letter and keys/values must be lowercase letters, digits, underscores or hyphens.`,
        });
      }
    }
  }

  return errors;
}
