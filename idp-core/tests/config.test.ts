import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config';

const FIXTURE = path.join(__dirname, 'fixtures/platform');

describe('loadConfig', () => {
  it('reads org prefix, region, environments and teams from the platform dir', () => {
    const cfg = loadConfig(FIXTURE);
    expect(cfg.orgPrefix).toBe('edo');
    expect(cfg.region).toBe('europe-west2');
    expect(cfg.environments).toEqual(['dev', 'test', 'prod']);
    expect(cfg.teams.map((t) => t.id)).toEqual(['platform', 'checkout']);
    expect(cfg.teams[0]).toEqual({ id: 'platform', name: 'Platform Engineering' });
  });

  it('resolves the real repo platform dir by default', () => {
    // The default dir must exist and contain the real teams (sanity that the
    // path resolution points at idp-gitops/platform).
    const cfg = loadConfig();
    expect(cfg.orgPrefix).toBe('edo');
    expect(cfg.teams.map((t) => t.id)).toContain('platform');
  });
});
