import type { PlatformConfig } from './config';

// Mirror the module's input validation (idp-gitops/modules/gcs-bucket/variables.tf)
// so the portal rejects bad requests before generating anything. The module and
// the policy gate remain the authoritative checks; this is a fast fail-early.

export interface BucketRequest {
  name: string;
  owning_team: string;
  environment: string;
}

export interface FieldError {
  field: keyof BucketRequest;
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
