// How a bucket gets its name.
//
// One function, because the name is derived in several places — the generator
// writes it into Terraform, the change layer reports it back to a caller, and
// the inventory reconstructs it when reading a stack off disk. Three copies of
// the rule is three chances for them to disagree, and they disagree silently:
// nothing fails, the platform just starts talking about a bucket that is not the
// one it provisioned.

export interface Naming {
  orgPrefix: string;
  region: string;
}

/**
 * `{orgPrefix}-{environment}-{team}-{name}`, lowercased.
 *
 * GCS bucket names are globally unique, so this is identity, not decoration:
 * change any part and it is a different bucket, which is why the API refuses to
 * treat these fields as mutable.
 */
export function bucketNameFor(orgPrefix: string, environment: string, team: string, name: string): string {
  return `${orgPrefix}-${environment}-${team}-${name}`.toLowerCase();
}

/** The same name, rebuilt from a stack directory (`<team>-<name>`). */
export function bucketNameFromDir(orgPrefix: string, environment: string, dirName: string): string {
  return `${orgPrefix}-${environment}-${dirName}`.toLowerCase();
}
