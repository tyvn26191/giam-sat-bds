// Calls to the worker API (/api/* — same origin via Firebase Hosting rewrite / Vite proxy).

import { auth } from './firebase';

export class ApiFailure extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly data: Record<string, unknown> = {}) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const user = auth.currentUser;
  const headers: Record<string, string> = {};
  if (user) headers.authorization = `Bearer ${await user.getIdToken()}`;
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(path, { method: init.method ?? 'GET', headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined });
  } catch {
    throw new ApiFailure(0, 'NETWORK', 'Không kết nối được máy chủ giám sát');
  }
  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    // empty / non-JSON body
  }
  if (!res.ok) {
    throw new ApiFailure(res.status, String(data.error ?? res.status), String(data.message ?? `Lỗi ${res.status}`), data);
  }
  return data as T;
}

export function errorText(e: unknown): string {
  if (e instanceof ApiFailure) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}
