import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

// The portal owns no config of its own: it reads the platform conventions that
// the module and policies already share (idp-gitops/platform/*). Single source
// of truth — never hardcode org prefix / region / envs / teams here.

export interface Team {
  id: string;
  name: string;
}

export interface PlatformConfig {
  orgPrefix: string;
  region: string;
  environments: string[];
  teams: Team[];
}

/** Default platform dir: idp-gitops/platform, relative to the repo root. */
export function defaultPlatformDir(): string {
  return process.env.PLATFORM_DIR ?? path.resolve(__dirname, '../../idp-gitops/platform');
}

export function loadConfig(dir: string = defaultPlatformDir()): PlatformConfig {
  const cfg = yaml.load(fs.readFileSync(path.join(dir, 'config.yaml'), 'utf8')) as {
    org_prefix: string;
    default_region: string;
    environments: string[];
  };
  const teamsDoc = yaml.load(fs.readFileSync(path.join(dir, 'teams.yaml'), 'utf8')) as {
    teams?: Array<{ id: string; name: string }>;
  };
  return {
    orgPrefix: cfg.org_prefix,
    region: cfg.default_region,
    environments: cfg.environments,
    teams: (teamsDoc.teams ?? []).map((t) => ({ id: t.id, name: t.name })),
  };
}
