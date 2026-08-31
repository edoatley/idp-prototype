// A unique request id recorded as the mandatory `request-id` label and in
// metadata.yaml. Must satisfy the GCS label-value charset: ^[a-z0-9_-]{1,63}$.
// team and name are already validated (lowercase alnum/hyphen), so the result is
// always in-charset.

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function randomSuffix(len = 4): string {
  let s = '';
  for (let i = 0; i < len; i++) {
    s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return s;
}

export interface RequestIdOptions {
  date?: Date;
  suffix?: () => string;
}

export function generateRequestId(team: string, name: string, opts: RequestIdOptions = {}): string {
  const date = opts.date ?? new Date();
  const suffix = (opts.suffix ?? randomSuffix)();
  const ymd = date.toISOString().slice(0, 10).replace(/-/g, '');
  return `req-${ymd}-${team}-${name}-${suffix}`;
}
