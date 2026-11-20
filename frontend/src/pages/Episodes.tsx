import { AlertTriangle, FileArchive, FileText, Film, Loader2, Play, Search, Trash2, Upload } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { del, upload } from "../lib/api";
import { fmtSec } from "../lib/format";
import { useApi, useStore } from "../lib/store";
import type { EpisodeDetail, EpisodeSummary } from "../lib/types";
import { Badge, BlockText, Button, Card, cx, Drawer, Empty, ErrorBox, Input, Modal, PageHeader, Select, Skeleton, StatusBadge } from "../components/ui";

interface UploadResult {
  episodes: { id: number; file: string; episode_number: number | null; status: string; scenes: number; elements: number; warnings: string[]; errors: string[]; replaced_episode_id: number | null }[];
  errors: { file: string; error: string }[];
}

export default function Episodes() {
  const { workspace, toast, refresh, startAnalysis, job } = useStore();
  const { data, error, loading } = useApi<EpisodeSummary[]>("/api/episodes");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [drag, setDrag] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [inspect, setInspect] = useState<number | null>(null);
  const [confirmDel, setConfirmDel] = useState<EpisodeSummary | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);
  const nav = useNavigate();
  const demo = workspace === "demo";
  const running = !!job && (job.status === "running" || job.status === "queued");

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data || []).filter(
      (e) =>
        (!status || e.status === status) &&
        (!s || String(e.episode_number) === s || e.logline?.toLowerCase().includes(s) || e.filename?.toLowerCase().includes(s) || e.title?.toLowerCase().includes(s)),
    );
  }, [data, q, status]);

  const doUpload = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      if (demo) {
        toast("err", "Uploads are disabled in demo mode", "Switch to the Live workspace to upload your own scripts.");
        return;
      }
      setProgress(0);
      try {
        const r: UploadResult = await upload(files, setProgress);
        setResult(r);
        const ok = r.episodes.filter((e) => e.status === "parsed").length;
        toast(ok ? "ok" : "err", `${ok} episode(s) parsed`, `${r.episodes.length - ok} with errors · ${r.errors.length} file(s) skipped`);
        refresh();
      } catch (e: any) {
        toast("err", "Upload failed", e.message);
      } finally {
        setProgress(null);
        if (fileRef.current) fileRef.current.value = "";
      }
    },
    [demo, toast, refresh],
  );

  const toggle = (id: number) => setSelected((s) => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  return (
    <>
      <PageHeader
        eyebrow="Episode Library"
        title="Screenplays"
        description="Upload ZIP archives or individual .txt scripts. Each file is parsed into scenes, camera directions, actions and timestamped dialogue — preserved exactly as written."
        actions={
          <>
            <Button icon={<Upload className="size-4" />} onClick={() => (demo ? toast("err", "Uploads are disabled in demo mode", "Switch to Live to upload.") : fileRef.current?.click())}>
              Upload files
            </Button>
            <Button
              variant="primary"
              icon={<Play className="size-4" />}
              disabled={demo || running || !(data && data.length)}
              onClick={() => startAnalysis(selected.size ? [...selected] : undefined)}
            >
              {running ? "Analysing…" : selected.size ? `Analyse ${selected.size} selected` : "Analyse all"}
            </Button>
          </>
        }
      />

      <input ref={fileRef} type="file" multiple accept=".zip,.txt,.text,.fountain,.md" className="hidden" onChange={(e) => doUpload(Array.from(e.target.files || []))} />

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          doUpload(Array.from(e.dataTransfer.files));
        }}
        onClick={() => progress === null && !demo && fileRef.current?.click()}
        className={cx(
          "relative rounded-2xl border-2 border-dashed p-8 text-center transition-all cursor-pointer overflow-hidden animate-fade-up",
          drag ? "border-accent bg-accent/[0.08] scale-[1.005]" : "border-line2 hover:border-accent/50 hover:bg-white/[0.015]",
          demo && "opacity-60 cursor-not-allowed",
        )}
      >
        <div className="absolute inset-x-0 top-0 h-3 sprocket opacity-60" />
        <div className="absolute inset-x-0 bottom-0 h-3 sprocket opacity-60" />
        {progress !== null ? (
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="size-7 text-accent animate-spin" />
            <div className="text-white font-medium">{progress < 100 ? `Uploading… ${progress}%` : "Extracting & parsing screenplays…"}</div>
            <div className="w-64 h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-accent to-accent2 transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <div className="flex gap-2 mb-1">
              <div className="grid place-items-center size-11 rounded-xl bg-accent/15 border border-accent/30 text-accent">
                <FileArchive className="size-5" />
              </div>
              <div className="grid place-items-center size-11 rounded-xl bg-accent2/10 border border-accent2/25 text-accent2">
                <FileText className="size-5" />
              </div>
            </div>
            <div className="text-white font-medium">{demo ? "Uploads disabled in demo mode" : "Drop screenplay ZIPs or .txt files here"}</div>
            <div className="text-[13px] text-mute">ZIPs are extracted automatically (nested folders supported). Re-uploading an episode number replaces it.</div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 mt-6 mb-4">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="size-4 text-dim absolute left-3 top-1/2 -translate-y-1/2" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by episode #, logline or filename…" className="w-full pl-9" />
        </div>
        <Select value={status} onChange={setStatus}>
          <option value="">All statuses</option>
          <option value="parsed">Parsed</option>
          <option value="analyzed">Analysed</option>
          <option value="analyzing">Analysing</option>
          <option value="analysis_failed">Analysis failed</option>
          <option value="parse_error">Parse error</option>
        </Select>
        <span className="text-[12.5px] text-mute">
          {filtered.length} of {data?.length ?? 0} episodes
        </span>
        {selected.size > 0 && (
          <button className="text-[12.5px] text-accent2 hover:underline" onClick={() => setSelected(new Set())}>
            Clear selection ({selected.size})
          </button>
        )}
      </div>

      {error && <ErrorBox message={error} onRetry={refresh} />}

      <Card className="overflow-hidden">
        {loading ? (
          <div className="p-4 space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}</div>
        ) : filtered.length === 0 ? (
          <Empty icon={<Film className="size-6" />} title={data?.length ? "No episodes match your filters" : "No episodes yet"} body={data?.length ? "Try a different search or status filter." : "Upload screenplay files to build your library."} />
        ) : (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.12em] text-dim border-b border-line">
                  <th className="pl-5 pr-2 py-3 w-8">
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      className="accent-[#8b5cf6]"
                      checked={filtered.length > 0 && filtered.every((e) => selected.has(e.id))}
                      onChange={(ev) => setSelected(ev.target.checked ? new Set(filtered.map((e) => e.id)) : new Set())}
                    />
                  </th>
                  <th className="px-3 py-3 font-semibold">Episode</th>
                  <th className="px-3 py-3 font-semibold">Logline</th>
                  <th className="px-3 py-3 font-semibold">Structure</th>
                  <th className="px-3 py-3 font-semibold">Status</th>
                  <th className="px-3 py-3 font-semibold">Promos</th>
                  <th className="px-3 py-3 font-semibold text-right pr-5">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtered.map((e) => (
                  <tr key={e.id} className={cx("hover:bg-white/[0.02] transition-colors group", selected.has(e.id) && "bg-accent/[0.04]")}>
                    <td className="pl-5 pr-2 py-4">
                      <input type="checkbox" aria-label={`Select episode ${e.episode_number}`} className="accent-[#8b5cf6]" checked={selected.has(e.id)} onChange={() => toggle(e.id)} />
                    </td>
                    <td className="px-3 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-3">
                        <div className="grid place-items-center size-10 rounded-xl bg-gradient-to-br from-accent/25 to-accent2/10 border border-white/10 font-bold text-white">{e.episode_number ?? "?"}</div>
                        <div>
                          <div className="text-white font-medium">Episode {e.episode_number ?? "—"}</div>
                          <div className="text-[11.5px] text-dim font-mono max-w-[180px] truncate" title={e.filename}>
                            {e.filename}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-4 text-zinc-300 max-w-[420px]">
                      <span className="line-clamp-2">{e.logline || <span className="text-dim italic">No logline</span>}</span>
                    </td>
                    <td className="px-3 py-4 whitespace-nowrap text-mute text-[12.5px]">
                      {e.scene_count} scenes · {e.element_count} lines
                      <div className="text-dim">{fmtSec(e.duration_s)} runtime</div>
                    </td>
                    <td className="px-3 py-4">
                      <div className="flex flex-col items-start gap-1">
                        <StatusBadge status={e.status} />
                        {(e.parse_warnings?.length ?? 0) > 0 && (
                          <span className="text-[11px] text-warn inline-flex items-center gap-1">
                            <AlertTriangle className="size-3" />
                            {e.parse_warnings.length} warning(s)
                          </span>
                        )}
                        {e.last_error && e.status === "analysis_failed" && (
                          <span className="text-[11px] text-bad max-w-[220px] line-clamp-2" title={e.last_error}>
                            {e.last_error}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-4 whitespace-nowrap">
                      {e.promo_count ? (
                        <Link to={`/promos?episode=${e.episode_number}`} className="text-zinc-200 hover:text-accent2">
                          {e.valid_promo_count}/{e.promo_count} valid
                          {e.best_score != null && <div className="text-[11.5px] text-mute">best {Math.round(e.best_score)}</div>}
                        </Link>
                      ) : (
                        <span className="text-dim">—</span>
                      )}
                    </td>
                    <td className="px-3 py-4 pr-5">
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="ghost" onClick={() => setInspect(e.id)}>
                          Inspect
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => nav(`/scenes?episode=${e.id}`)} className="hidden xl:inline-flex">
                          Timeline
                        </Button>
                        <Button size="sm" disabled={demo || running || e.status === "parse_error"} onClick={() => startAnalysis([e.id])} icon={<Play className="size-3.5" />}>
                          {e.status === "analyzed" ? "Re-run" : "Analyse"}
                        </Button>
                        <Button size="sm" variant="ghost" disabled={demo} onClick={() => setConfirmDel(e)} aria-label="Delete episode" className="!px-2 hover:!text-bad">
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ScriptDrawer id={inspect} onClose={() => setInspect(null)} />

      <Modal
        open={!!result}
        onClose={() => setResult(null)}
        title="Upload results"
        footer={<Button variant="primary" onClick={() => setResult(null)}>Done</Button>}
      >
        <div className="space-y-2 max-h-[55vh] overflow-y-auto scroll-thin -mr-2 pr-2">
          {result?.episodes.map((r) => (
            <div key={r.id} className="rounded-xl border border-line p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[13px] text-white font-medium truncate">
                  Ep {r.episode_number ?? "?"} · <span className="font-mono text-mute text-[12px]">{r.file}</span>
                </div>
                <StatusBadge status={r.status} />
              </div>
              <div className="text-[12px] text-mute mt-1">
                {r.scenes} scenes · {r.elements} timed lines{r.replaced_episode_id ? " · replaced previous version" : ""}
              </div>
              {[...r.errors.map((x) => ["bad", x]), ...r.warnings.slice(0, 4).map((x) => ["warn", x])].map(([t, m], i) => (
                <div key={i} className={cx("text-[12px] mt-1", t === "bad" ? "text-bad" : "text-warn")}>
                  • {m}
                </div>
              ))}
              {r.warnings.length > 4 && <div className="text-[12px] text-dim mt-1">+{r.warnings.length - 4} more warnings</div>}
            </div>
          ))}
          {result?.errors.map((e, i) => (
            <div key={i} className="rounded-xl border border-bad/25 bg-bad/[0.04] p-3 text-[12.5px]">
              <span className="font-mono text-zinc-300">{e.file}</span> — <span className="text-bad">{e.error}</span>
            </div>
          ))}
        </div>
      </Modal>

      <Modal
        open={!!confirmDel}
        onClose={() => setConfirmDel(null)}
        title="Delete episode?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDel(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              icon={<Trash2 className="size-4" />}
              onClick={async () => {
                try {
                  await del(`/api/episodes/${confirmDel!.id}`);
                  toast("ok", `Episode ${confirmDel!.episode_number} deleted`);
                  refresh();
                } catch (e: any) {
                  toast("err", "Delete failed", e.message);
                }
                setConfirmDel(null);
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-zinc-300">
          This removes Episode {confirmDel?.episode_number}, its parsed script and all its promo candidates and reviews from the live workspace. This cannot be undone.
        </p>
      </Modal>
    </>
  );
}

export function ScriptDrawer({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { data } = useApi<EpisodeDetail>(id ? `/api/episodes/${id}` : null, [id]);
  const [tab, setTab] = useState<"parsed" | "raw" | "notes">("parsed");
  const ep = data && data.id === id ? data : null;
  return (
    <Drawer open={id !== null} onClose={onClose} title={ep ? `Episode ${ep.episode_number}` : "Loading…"} subtitle={ep?.filename} width="max-w-4xl">
      {!ep ? (
        <div className="p-6 space-y-3">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : (
        <div className="p-6">
          <p className="text-zinc-300 text-[14px] leading-relaxed">{ep.logline}</p>
          <div className="flex flex-wrap gap-2 mt-3">
            <StatusBadge status={ep.status} />
            <Badge>{ep.scene_count} scenes</Badge>
            <Badge>{ep.parsed.dialogue_count} dialogue lines</Badge>
            <Badge>{fmtSec(ep.duration_s)} runtime</Badge>
            {ep.source_archive && <Badge tone="info">from {ep.source_archive}</Badge>}
          </div>
          <div className="flex gap-1 mt-5 border-b border-line">
            {(["parsed", "raw", "notes"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={cx("px-3 h-9 text-[13px] font-medium border-b-2 -mb-px transition", tab === t ? "border-accent text-white" : "border-transparent text-mute hover:text-white")}>
                {t === "parsed" ? "Parsed screenplay" : t === "raw" ? "Original text" : `Continuity & warnings`}
              </button>
            ))}
          </div>
          {tab === "parsed" && (
            <div className="mt-5 space-y-6">
              {ep.parsed.scenes.map((s) => (
                <section key={s.number}>
                  <div className="flex flex-wrap items-center gap-3 sticky top-0 bg-surface/95 backdrop-blur py-2 z-10">
                    <span className="text-[11px] font-bold tracking-[0.14em] text-accent">SCENE {s.number}</span>
                    <span className="text-white font-semibold text-[13.5px]">{s.heading}</span>
                    <span className="font-mono text-[11.5px] text-accent2 ml-auto">
                      {s.start} → {s.end}
                      {s.inferred_bounds && <span className="text-warn ml-1">(inferred)</span>}
                    </span>
                  </div>
                  {s.camera.map((c, i) => (
                    <div key={i} className="text-[12px] text-hot/90 italic mt-1 pl-1">
                      🎥 {c}
                    </div>
                  ))}
                  <div className="mt-2 rounded-xl border border-line divide-y divide-line overflow-hidden">
                    {s.elements.map((e) => (
                      <div key={e.id} className="flex gap-3 px-4 py-2.5 text-[13px] hover:bg-white/[0.02]">
                        <span className="font-mono text-[10.5px] text-dim w-10 shrink-0 pt-0.5">{e.id}</span>
                        <span className="font-mono text-[11px] text-mute w-[124px] shrink-0 pt-0.5">
                          {e.start ?? "--"}–{e.end ?? "--"}
                        </span>
                        <span className="min-w-0">
                          {e.kind === "dialogue" ? (
                            <>
                              <b className="text-white text-[12px] tracking-wide">{e.character}</b>
                              {e.parenthetical && <span className="text-dim italic ml-1">({e.parenthetical})</span>}
                              <span className="text-zinc-300 ml-2">{e.text}</span>
                            </>
                          ) : (
                            <BlockText kind={e.kind} text={e.text} />
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
          {tab === "raw" && <pre className="mt-5 text-[12.5px] leading-relaxed font-mono text-zinc-300 whitespace-pre-wrap bg-black/30 border border-line rounded-xl p-4">{ep.raw_text}</pre>}
          {tab === "notes" && (
            <div className="mt-5 space-y-5">
              <div>
                <h4 className="text-[12px] uppercase tracking-[0.14em] text-dim font-semibold mb-2">Continuity notes</h4>
                <ul className="list-disc pl-5 space-y-1 text-[13.5px] text-zinc-300">
                  {ep.continuity_notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                  {!ep.continuity_notes.length && <li className="text-dim">None found</li>}
                </ul>
              </div>
              <div>
                <h4 className="text-[12px] uppercase tracking-[0.14em] text-dim font-semibold mb-2">Parser warnings & errors</h4>
                {[...ep.parse_errors.map((x) => ["bad", x]), ...ep.parse_warnings.map((x) => ["warn", x])].map(([t, m], i) => (
                  <div key={i} className={cx("text-[13px]", t === "bad" ? "text-bad" : "text-warn")}>
                    • {m}
                  </div>
                ))}
                {!ep.parse_errors.length && !ep.parse_warnings.length && <div className="text-[13px] text-ok">No issues — clean parse.</div>}
              </div>
              <div>
                <h4 className="text-[12px] uppercase tracking-[0.14em] text-dim font-semibold mb-2">Analysis runs</h4>
                {ep.runs.map((r) => (
                  <div key={r.id} className="text-[13px] text-zinc-300 flex flex-wrap gap-2 items-center py-1">
                    <Badge tone={r.status === "completed" ? "ok" : r.status === "failed" ? "bad" : "mute"}>{r.status}</Badge>
                    run #{r.id} · {r.provider}/{r.model} · {r.candidate_count} candidates ({r.valid_count} valid)
                    {r.error && <span className="text-bad text-[12px] w-full">{r.error}</span>}
                  </div>
                ))}
                {!ep.runs.length && <div className="text-[13px] text-dim">Not analysed yet.</div>}
              </div>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

