// Engine API client: REST calls and one auto-reconnecting WebSocket with channel subscriptions.
// Integers arrive as decimal strings (bigint-safe); callers convert with BigInt().

export const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8787';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly logs?: string[],
  ) {
    super(message);
  }
}

export async function get<T>(path: string): Promise<T> {
  const r = await fetch(API_URL + path);
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new ApiError(j.error ?? r.statusText, r.status);
  return j;
}

export async function post<T>(path: string, body: unknown, token?: string): Promise<T> {
  const r = await fetch(API_URL + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string; code?: string; logs?: string[] };
  if (!r.ok) throw new ApiError(j.error ?? r.statusText, r.status, j.code, j.logs);
  return j;
}

type Handler = (data: unknown) => void;

/** Shared WebSocket: subscribe to channels (`prices`, `markets`, `pool`, `status`, `account:<owner>`, `trades:<market>`). */
class Stream {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private retry = 0;
  connected = false;
  private statusListeners = new Set<(up: boolean) => void>();

  private url() {
    return API_URL.replace(/^http/, 'ws') + '/v1/ws';
  }

  private open() {
    const ws = new WebSocket(this.url());
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.setConnected(true);
      for (const ch of this.handlers.keys()) ws.send(JSON.stringify({ op: 'sub', ch }));
    };
    ws.onmessage = (ev) => {
      try {
        const { ch, data } = JSON.parse(ev.data as string) as { ch: string; data: unknown };
        this.handlers.get(ch)?.forEach((h) => h(data));
      } catch {
        // ignore malformed frames
      }
    };
    ws.onclose = () => {
      this.setConnected(false);
      this.ws = null;
      const delay = Math.min(10_000, 500 * 2 ** this.retry++);
      setTimeout(() => this.open(), delay);
    };
  }

  private setConnected(up: boolean) {
    this.connected = up;
    this.statusListeners.forEach((l) => l(up));
  }

  onStatus(l: (up: boolean) => void) {
    this.statusListeners.add(l);
    return () => this.statusListeners.delete(l);
  }

  subscribe(ch: string, h: Handler): () => void {
    if (!this.ws) this.open();
    let set = this.handlers.get(ch);
    if (!set) {
      set = new Set();
      this.handlers.set(ch, set);
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ op: 'sub', ch }));
    }
    set.add(h);
    return () => {
      set!.delete(h);
      if (set!.size === 0) {
        this.handlers.delete(ch);
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ op: 'unsub', ch }));
      }
    };
  }
}

export const stream = new Stream();
