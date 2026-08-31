import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config';
import { validate } from '../src/validate';

const config = loadConfig(path.join(__dirname, 'fixtures/platform'));

describe('validate', () => {
  it('accepts a well-formed request', () => {
    expect(validate({ name: 'orders', owning_team: 'checkout', environment: 'dev' }, config)).toEqual([]);
  });

  it('rejects a bad name (uppercase / underscore / too short)', () => {
    expect(validate({ name: 'Bad_Name', owning_team: 'checkout', environment: 'dev' }, config)).toContainEqual(
      expect.objectContaining({ field: 'name' }),
    );
    expect(validate({ name: 'ab', owning_team: 'checkout', environment: 'dev' }, config)).toContainEqual(
      expect.objectContaining({ field: 'name' }),
    );
  });

  it('rejects an unknown environment', () => {
    expect(validate({ name: 'orders', owning_team: 'checkout', environment: 'staging' }, config)).toContainEqual(
      expect.objectContaining({ field: 'environment' }),
    );
  });

  it('rejects an unknown team', () => {
    expect(validate({ name: 'orders', owning_team: 'ghosts', environment: 'dev' }, config)).toContainEqual(
      expect.objectContaining({ field: 'owning_team' }),
    );
  });

  it('reports multiple errors at once', () => {
    const errors = validate({ name: 'X', owning_team: 'ghosts', environment: 'staging' }, config);
    expect(errors.map((e) => e.field).sort()).toEqual(['environment', 'name', 'owning_team']);
  });
});
