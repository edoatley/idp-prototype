// Shared fake fetch for credential-free tests: canned responses keyed by
// method + URL regex. Returns a minimal Response with text()/json via text().

export interface Handler {
  match: RegExp;
  method?: string;
  status?: number;
  body: unknown;
}

export function makeFetch(handlers: Handler[]) {
  const calls: Array<{ method: string; url: string; body: unknown }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body ? JSON.parse(init.body as string) : undefined });
    const h = handlers.find((x) => (x.method ?? 'GET') === method && x.match.test(url));
    if (!h) throw new Error(`unexpected ${method} ${url}`);
    return { status: h.status ?? 200, text: async () => (h.body === undefined ? '' : JSON.stringify(h.body)) } as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}
