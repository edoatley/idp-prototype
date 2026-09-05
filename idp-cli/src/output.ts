import yaml from 'js-yaml';

// Output rendering. `table` is for humans, `json`/`yaml` for pipelines — the
// point of a CLI over a curl script is that both are first-class.

export type Format = 'table' | 'json' | 'yaml';

export function render(format: Format, data: unknown, table: () => string): string {
  if (format === 'json') return JSON.stringify(data, null, 2);
  if (format === 'yaml') return yaml.dump(data, { lineWidth: 100 });
  return table();
}

/** A plain column-aligned table. No box drawing — it stays greppable and pasteable. */
export function table(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return '(none)';
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (cells: string[]) => cells.map((c, i) => (c ?? '').padEnd(widths[i]!)).join('  ').trimEnd();
  return [line(headers), line(widths.map((w) => '-'.repeat(w))), ...rows.map(line)].join('\n');
}

export function keyValue(pairs: Array<[string, string]>): string {
  const width = Math.max(...pairs.map(([k]) => k.length));
  return pairs.map(([k, v]) => `${`${k}:`.padEnd(width + 1)}  ${v}`).join('\n');
}

export const dash = (v: unknown): string => (v === null || v === undefined || v === '' ? '-' : String(v));

export function pct(n: number | null | undefined): string {
  return n === null || n === undefined ? '-' : `${Math.round(n * 100)}%`;
}

/** Statuses carry a glyph so a long list scans at a glance. */
export function statusLabel(status: string): string {
  const glyph: Record<string, string> = {
    pending_review: '⏳',
    blocked: '⛔',
    merged: '🔄',
    applied: '✅',
    decommissioned: '♻️',
    failed: '❌',
    cancelled: '⊘',
  };
  return `${glyph[status] ?? '•'} ${status}`;
}
