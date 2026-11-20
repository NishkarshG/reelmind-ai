import type { Workspace } from "./types";

/**
 * API client.
 * - Normal mode: talks to the FastAPI backend (VITE_API_URL or same origin / Vite proxy).
 * - Static preview mode (VITE_STATIC_DEMO=1, used for the Netlify preview): serves a
 *   read-only snapshot of the DEMO workspace from /static-demo/*.json. Nothing is
 *   ever fabricated: write actions explain that a backend is required.
 */
export const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";
export const STATIC_MODE = import.meta.env.VITE_STATIC_DEMO === "1";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}

let workspace: Workspace = STATIC_MODE ? "demo" : ((localStorage.getItem("rm.workspace") as Workspace) || "live");
export const getWorkspace = () => workspace;
export const setWorkspaceGlobal = (w: Workspace) => {
  workspace = STATIC_MODE ? "demo" : w;
  try {
    localStorage.setItem("rm.workspace", workspace);
  } catch {
    /* ignore */
  }
};

function staticPath(path: string): string | null {
  const p = path.split("?")[0];
  const map: Record<string, string> = {
    "/api/health": "health",
    "/api/dashboard": "dashboard",
    "/api/episodes": "episodes",
    "/api/promos": "promos",
    "/api/analytics": "analytics",
    "/api/evaluation": "evaluation",
    "/api/settings": "settings",
    "/api/jobs": "jobs",
    "/api/activity": "activity",
  };
  if (map[p]) return `/static-demo/${map[p]}.json`;
  const m = p.match(/^\/api\/episodes\/(\d+)$/);
  if (m) return `/static-demo/episode_${m[1]}.json`;
  const r = p.match(/^\/api\/runs\/(\d+)$/);
  if (r) return `/static-demo/run_${r[1]}.json`;
  return null;
}

export const STATIC_WRITE_MSG =
  "This is the static Netlify preview of the demo workspace. Uploading, AI analysis and editing need the Python backend — see the README to run it locally or deploy it.";

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method || "GET").toUpperCase();
  if (STATIC_MODE) {
    if (method !== "GET") throw new ApiError(STATIC_WRITE_MSG, 403);
    const sp = staticPath(path);
    if (!sp) throw new ApiError("Not available in static preview.", 404);
    const r = await fetch(sp);
    if (!r.ok) throw new ApiError("Not available in static preview.", r.status);
    return r.json();
  }
  const headers = new Headers(init.headers);
  headers.set("X-Workspace", workspace);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  let r: Response;
  try {
    r = await fetch(API_BASE + path, { ...init, headers });
  } catch {
    throw new ApiError("Cannot reach the REELMIND backend. Is the API server running on port 8000?", 0);
  }
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`;
    try {
      const j = await r.json();
      msg = typeof j.detail === "string" ? j.detail : j.message || JSON.stringify(j.detail ?? j);
    } catch {
      /* not json */
    }
    throw new ApiError(msg, r.status);
  }
  return r.json();
}

export const post = <T,>(path: string, body?: unknown) =>
  api<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
export const patch = <T,>(path: string, body: unknown) => api<T>(path, { method: "PATCH", body: JSON.stringify(body) });
export const put = <T,>(path: string, body: unknown) => api<T>(path, { method: "PUT", body: JSON.stringify(body) });
export const del = <T,>(path: string) => api<T>(path, { method: "DELETE" });

/** Upload with progress (XHR gives upload progress events; fetch does not). */
export function upload(files: File[], onProgress: (pct: number) => void): Promise<any> {
  if (STATIC_MODE) return Promise.reject(new ApiError(STATIC_WRITE_MSG, 403));
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f, f.name));
    const xhr = new XMLHttpRequest();
    xhr.open("POST", API_BASE + "/api/episodes/upload");
    xhr.setRequestHeader("X-Workspace", workspace);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      let body: any = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new ApiError(body?.detail || `Upload failed (${xhr.status})`, xhr.status));
    };
    xhr.onerror = () => reject(new ApiError("Cannot reach the REELMIND backend.", 0));
    xhr.send(fd);
  });
}

/** Trigger a file download from the API (or static snapshot). */
export async function download(kind: "csv" | "json" | "zip", ids?: number[]) {
  let url: string;
  if (STATIC_MODE) {
    url = { csv: "/static-demo/promos.csv", json: "/static-demo/promos_export.json", zip: "/static-demo/outputs.zip" }[kind];
  } else {
    const q = new URLSearchParams({ workspace });
    if (ids?.length) q.set("ids", ids.join(","));
    url = `${API_BASE}/api/export/${kind === "zip" ? "outputs.zip" : `promos.${kind}`}?${q}`;
  }
  const r = await fetch(url);
  if (!r.ok) throw new ApiError(`Export failed (${r.status})`, r.status);
  const blob = await r.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `reelmind_${workspace}_${kind === "zip" ? "outputs.zip" : `promos.${kind}`}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
