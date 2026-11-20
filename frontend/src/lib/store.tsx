import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, getWorkspace, post, setWorkspaceGlobal, STATIC_MODE } from "./api";
import type { Job, Workspace } from "./types";

type Toast = { id: number; kind: "ok" | "err" | "info"; title: string; body?: string };

interface Store {
  workspace: Workspace;
  setWorkspace: (w: Workspace) => void;
  version: number; // bump to refetch data everywhere
  refresh: () => void;
  toast: (kind: Toast["kind"], title: string, body?: string) => void;
  toasts: Toast[];
  dismiss: (id: number) => void;
  job: Job | null;
  startAnalysis: (episodeIds?: number[], provider?: string) => Promise<void>;
  backendOnline: boolean | null;
}

const Ctx = createContext<Store>(null as unknown as Store);
export const useStore = () => useContext(Ctx);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [workspace, setWs] = useState<Workspace>(getWorkspace());
  const [version, setVersion] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [job, setJob] = useState<Job | null>(null);
  const [backendOnline, setOnline] = useState<boolean | null>(null);
  const seq = useRef(0);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (kind: Toast["kind"], title: string, body?: string) => {
      const id = ++seq.current;
      setToasts((t) => [...t.slice(-3), { id, kind, title, body }]);
      setTimeout(() => dismiss(id), kind === "err" ? 8000 : 4500);
    },
    [dismiss],
  );

  const setWorkspace = useCallback((w: Workspace) => {
    setWorkspaceGlobal(w);
    setWs(w);
    setJob(null);
    setVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    api<{ ok: boolean }>("/api/health")
      .then(() => setOnline(true))
      .catch(() => setOnline(false));
  }, [version]);

  // pick up a job already running (e.g. after page reload)
  useEffect(() => {
    if (STATIC_MODE) return;
    api<Job[]>("/api/jobs")
      .then((js) => {
        const running = js.find((j) => j.status === "running" || j.status === "queued");
        if (running) setJob(running);
      })
      .catch(() => {});
  }, [workspace]);

  // poll the active job
  useEffect(() => {
    if (!job || !(job.status === "running" || job.status === "queued")) return;
    const t = setInterval(async () => {
      try {
        const j = await api<Job>(`/api/jobs/${job.id}`);
        setJob(j);
        setVersion((v) => v + 1);
        if (j.status !== "running" && j.status !== "queued") {
          if (j.status === "completed") toast("ok", "Analysis complete", j.message);
          else if (j.status === "completed_with_errors") toast("err", "Analysis finished with errors", j.message);
          else toast("err", "Analysis failed", parseJobError(j.error) || j.message);
        }
      } catch {
        /* transient */
      }
    }, 1200);
    return () => clearInterval(t);
  }, [job, toast]);

  const startAnalysis = useCallback(
    async (episodeIds?: number[], provider?: string) => {
      try {
        const j = await post<Job>("/api/analysis/run", { episode_ids: episodeIds ?? null, provider: provider ?? null });
        setJob(j);
        toast("info", "Analysis started", `${j.total} episode(s) · ${j.provider} / ${j.model}`);
        refresh();
      } catch (e: any) {
        toast("err", "Could not start analysis", e.message);
      }
    },
    [toast, refresh],
  );

  return (
    <Ctx.Provider
      value={{ workspace, setWorkspace, version, refresh, toast, toasts, dismiss, job, startAnalysis, backendOnline }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function parseJobError(e: string | null): string | undefined {
  if (!e) return undefined;
  try {
    const arr = JSON.parse(e) as { episode_number: number; error: string }[];
    return arr.map((x) => `Ep ${x.episode_number}: ${x.error}`).join("\n");
  } catch {
    return e;
  }
}

/** Fetch helper that re-runs whenever the global version / workspace changes. */
export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const { version, workspace } = useStore();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const first = useRef(true);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    if (first.current) setLoading(true);
    api<T>(path)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setError(null);
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => {
        if (!alive) return;
        setLoading(false);
        first.current = false;
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, version, workspace, ...deps]);
  useEffect(() => {
    first.current = true;
    setData(null);
  }, [workspace]);
  return { data, error, loading, setData };
}
