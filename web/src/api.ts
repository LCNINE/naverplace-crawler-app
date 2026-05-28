import type { Task, QueueFullState } from "./types";

const BASE = import.meta.env.VITE_API_URL ?? "";

let _token: string | null = localStorage.getItem("auth_token");

export const setAuthToken = (token: string | null) => {
  _token = token;
  if (token) localStorage.setItem("auth_token", token);
  else localStorage.removeItem("auth_token");
};

export const getAuthToken = () => _token;

const json = async <T>(res: Response): Promise<T> => {
  if (!res.ok) {
    if (res.status === 401) {
      setAuthToken(null);
      window.dispatchEvent(new CustomEvent("auth:logout"));
    }
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
};

const authFetch = (url: string, options: RequestInit = {}) =>
  fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      ...(_token ? { Authorization: `Bearer ${_token}` } : {}),
    },
  });

type DateParams = { since?: string; until?: string; order?: "asc" | "desc" };

export const api = {
  login: (email: string, password: string) =>
    fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    }).then((r) => json<{ access_token: string; expires_at: number }>(r)),

  getQueueState: () =>
    authFetch(`${BASE}/api/queue/state`).then((r) => json<QueueFullState>(r)),

  getTasks: () =>
    fetch(`${BASE}/api/tasks`).then((r) => json<{ tasks: Task[] }>(r)).then((d) => d.tasks),

  addTask: (body: {
    keyword: string;
    table: string;
    slowMo: number;
    collectMenu: boolean;
    extraCategoryKeywords: string[];
  }) =>
    authFetch(`${BASE}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => json<Task>(r)),

  updateTask: (id: string, body: Partial<Omit<Task, "id">>) =>
    authFetch(`${BASE}/api/tasks/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => json<Task>(r)),

  deleteTask: (id: string) =>
    authFetch(`${BASE}/api/tasks/${id}`, { method: "DELETE" }).then((r) => json<{ ok: boolean }>(r)),

  reorderTasks: (ids: string[]) =>
    authFetch(`${BASE}/api/tasks/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    }).then((r) => json<{ ok: boolean }>(r)),

  startQueue: () =>
    authFetch(`${BASE}/api/queue/start`, { method: "POST" }).then((r) => json<{ ok: boolean }>(r)),

  stopQueue: () =>
    authFetch(`${BASE}/api/queue/stop`, { method: "POST" }).then((r) => json<{ ok: boolean }>(r)),

  stopSlot: (slotId: number) =>
    authFetch(`${BASE}/api/workers/${slotId}/stop`, { method: "POST" }).then((r) => json<{ ok: boolean }>(r)),

  resetProgress: (id: string) =>
    authFetch(`${BASE}/api/tasks/${id}/reset-progress`, { method: "POST" }).then((r) => json<{ ok: boolean }>(r)),

  getTables: () =>
    authFetch(`${BASE}/api/tables`).then((r) => json<{ usedTables: string[]; otherTables: string[] }>(r)),

  getNewShops: (table: string, params?: DateParams) => {
    const p = new URLSearchParams();
    if (params?.since) p.set("since", params.since);
    if (params?.until) p.set("until", params.until);
    if (params?.order) p.set("order", params.order);
    const qs = p.toString() ? `?${p}` : "";
    return authFetch(`${BASE}/api/analysis/${encodeURIComponent(table)}/new-shops${qs}`).then((r) =>
      json<{ data: Record<string, unknown>[] }>(r)
    );
  },

  getMissingShops: (table: string, params?: DateParams) => {
    const p = new URLSearchParams();
    if (params?.since) p.set("since", params.since);
    if (params?.until) p.set("until", params.until);
    if (params?.order) p.set("order", params.order);
    const qs = p.toString() ? `?${p}` : "";
    return authFetch(`${BASE}/api/analysis/${encodeURIComponent(table)}/missing-shops${qs}`).then((r) =>
      json<{ data: Record<string, unknown>[] }>(r)
    );
  },

  getEvents: (table: string, eventType: string, params?: DateParams) => {
    const p = new URLSearchParams({ event_type: eventType });
    if (params?.since) p.set("since", params.since);
    if (params?.until) p.set("until", params.until);
    if (params?.order) p.set("order", params.order);
    return authFetch(`${BASE}/api/analysis/${encodeURIComponent(table)}/events?${p}`).then((r) =>
      json<{ data: Record<string, unknown>[] }>(r)
    );
  },

  getAllShops: (table: string, params?: DateParams) => {
    const p = new URLSearchParams();
    if (params?.since) p.set("since", params.since);
    if (params?.until) p.set("until", params.until);
    if (params?.order) p.set("order", params.order);
    const qs = p.toString() ? `?${p}` : "";
    return authFetch(`${BASE}/api/analysis/${encodeURIComponent(table)}/all-shops${qs}`).then((r) =>
      json<{ data: Record<string, unknown>[] }>(r)
    );
  },
};
