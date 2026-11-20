import { AlertOctagon, CheckCircle2, ClipboardCheck, Clock3, FileWarning, HelpCircle, Package, ScanSearch, Timer, TrendingDown, UserCheck, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { PromoDrawer } from "../components/Promo";
import { Badge, Button, Card, CardHeader, cx, ErrorBox, FlagBadge, PageHeader, ReviewBadge, Select, Skeleton } from "../components/ui";
import { api, download } from "../lib/api";
import { FLAG_LABELS, fmtDur, scoreHex } from "../lib/format";
import { useApi, useStore } from "../lib/store";
import type { Promo, Run } from "../lib/types";

interface Evaluation {
  summary: {
    total_candidates: number;
    valid: number;
    invalid: number;
    invalid_timestamp: number;
    duration_out_of_range: number;
    unverified_excerpt: number;
    weak_hook: number;
    weak_cliffhanger: number;
    potentially_confusing: number;
    review: Record<string, number>;
    failed_runs: number;
    parse_warnings: number;
    parse_errors: number;
  };
  error_codes: Record<string, number>;
  candidates: Pick<Promo, "id" | "rank" | "episode_number" | "title" | "start_ts" | "end_ts" | "duration_s" | "overall" | "scores" | "flags" | "validation_status" | "validation_errors" | "review_status" | "provider" | "model">[];
  runs: Run[];
  parse_issues: { episode_number: number; filename: string; status: string; warnings: string[]; errors: string[] }[];
}

export default function Evaluation() {
  const { data, error, loading } = useApi<Evaluation>("/api/evaluation");
  const { refresh, toast } = useStore();
  const [flag, setFlag] = useState("");
  const [review, setReview] = useState("");
  const [open, setOpen] = useState<Promo | null>(null);

  const rows = useMemo(
    () =>
      (data?.candidates || []).filter(
        (c) => (!flag || (flag === "invalid" ? c.validation_status === "invalid" : flag === "clean" ? c.flags.length === 0 : c.flags.includes(flag))) && (!review || c.review_status === review),
      ),
    [data, flag, review],
  );

  if (error) return <ErrorBox message={error} onRetry={refresh} />;
  const s = data?.summary;
  const tiles = s
    ? [
        { k: "invalid_timestamp", label: "Invalid timestamps", v: s.invalid_timestamp, icon: <Clock3 className="size-4" />, tone: "bad" },
        { k: "duration_out_of_range", label: "Outside 20–60s", v: s.duration_out_of_range, icon: <Timer className="size-4" />, tone: "bad" },
        { k: "unverified_excerpt", label: "Unverified excerpts", v: s.unverified_excerpt, icon: <ScanSearch className="size-4" />, tone: "bad" },
        { k: "weak_hook", label: "Weak hooks", v: s.weak_hook, icon: <TrendingDown className="size-4" />, tone: "warn" },
        { k: "weak_cliffhanger", label: "Weak cliffhangers", v: s.weak_cliffhanger, icon: <AlertOctagon className="size-4" />, tone: "warn" },
        { k: "potentially_confusing", label: "Potentially confusing", v: s.potentially_confusing, icon: <HelpCircle className="size-4" />, tone: "warn" },
      ]
    : [];

  const openPromo = async (id: number) => {
    try {
      const all = await api<Promo[]>("/api/promos");
      setOpen(all.find((p) => p.id === id) || null);
    } catch (e: any) {
      toast("err", "Could not load promo", e.message);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Quality Evaluation"
        title="Validation & human review"
        description="Every candidate the model proposed is kept here — including ones that failed validation — so you can audit timestamp accuracy, duration limits, hook/cliffhanger strength and review progress."
        actions={
          <Button icon={<Package className="size-4" />} onClick={() => download("zip").then(() => toast("ok", "Raw outputs downloaded")).catch((e) => toast("err", "Export failed", e.message))}>
            Download evaluation bundle
          </Button>
        }
      />

      {loading || !s ? (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : (
        <>
          <div className="grid md:grid-cols-3 gap-4 mb-4">
            <Card className="p-5 md:col-span-1 animate-fade-up">
              <div className="text-[12.5px] text-mute">Validation pass rate</div>
              <div className="flex items-end gap-2 mt-2">
                <span className="text-[34px] font-semibold text-white tabular-nums">{s.total_candidates ? Math.round((s.valid / s.total_candidates) * 100) : 0}%</span>
                <span className="text-mute text-sm mb-2">
                  {s.valid}/{s.total_candidates}
                </span>
              </div>
              <div className="h-2 rounded-full bg-bad/30 overflow-hidden mt-2">
                <div className="h-full bg-ok" style={{ width: `${s.total_candidates ? (s.valid / s.total_candidates) * 100 : 0}%` }} />
              </div>
              <div className="flex gap-4 mt-3 text-[12px] text-mute">
                <span className="inline-flex items-center gap-1">
                  <CheckCircle2 className="size-3.5 text-ok" /> {s.valid} valid
                </span>
                <span className="inline-flex items-center gap-1">
                  <XCircle className="size-3.5 text-bad" /> {s.invalid} invalid
                </span>
              </div>
            </Card>
            <Card className="p-5 animate-fade-up">
              <div className="text-[12.5px] text-mute flex items-center gap-1.5">
                <UserCheck className="size-4" /> Human review status
              </div>
              <div className="grid grid-cols-3 gap-2 mt-3">
                {(["pending", "approved", "rejected"] as const).map((k) => (
                  <button key={k} onClick={() => setReview(review === k ? "" : k)} className={cx("rounded-xl border p-3 text-left transition", review === k ? "border-accent/50 bg-accent/10" : "border-line hover:border-line2")}>
                    <div className="text-[22px] font-semibold text-white tabular-nums">{s.review[k] || 0}</div>
                    <div className="text-[11.5px] text-mute capitalize">{k}</div>
                  </button>
                ))}
              </div>
            </Card>
            <Card className="p-5 animate-fade-up">
              <div className="text-[12.5px] text-mute flex items-center gap-1.5">
                <FileWarning className="size-4" /> Pipeline health
              </div>
              <div className="space-y-2 mt-3 text-[13px]">
                <Row l="Failed AI runs" v={s.failed_runs} bad={s.failed_runs > 0} />
                <Row l="Parser errors" v={s.parse_errors} bad={s.parse_errors > 0} />
                <Row l="Parser warnings" v={s.parse_warnings} warn={s.parse_warnings > 0} />
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            {tiles.map((t, i) => (
              <button
                key={t.k}
                onClick={() => setFlag(flag === t.k ? "" : t.k)}
                style={{ animationDelay: `${i * 40}ms` }}
                className={cx("card p-4 text-left transition animate-fade-up hover:border-white/15", flag === t.k && (t.tone === "bad" ? "border-bad/50 bg-bad/[0.06]" : "border-warn/50 bg-warn/[0.06]"))}
              >
                <div className={cx("flex items-center gap-2 text-[12px]", t.tone === "bad" ? "text-bad" : "text-warn")}>
                  {t.icon}
                  {t.label}
                </div>
                <div className="text-[26px] font-semibold text-white mt-1 tabular-nums">{t.v}</div>
              </button>
            ))}
          </div>
        </>
      )}

      <Card className="mt-4 overflow-hidden animate-fade-up">
        <CardHeader
          title="All candidates"
          subtitle={`${rows.length} shown · failed candidates are never silently removed`}
          icon={<ClipboardCheck className="size-4" />}
          action={
            <div className="flex gap-2">
              <Select value={flag} onChange={setFlag}>
                <option value="">All flags</option>
                <option value="invalid">Failed validation</option>
                <option value="clean">No flags</option>
                {Object.entries(FLAG_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </Select>
              <Select value={review} onChange={setReview}>
                <option value="">Any review</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </Select>
            </div>
          }
        />
        <div className="overflow-x-auto scroll-thin">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-[0.12em] text-dim border-y border-line">
                <th className="px-5 py-2.5">Rank</th>
                <th className="px-3 py-2.5">Candidate</th>
                <th className="px-3 py-2.5">Time</th>
                <th className="px-3 py-2.5">Score</th>
                <th className="px-3 py-2.5">H / C / E / S</th>
                <th className="px-3 py-2.5">Validation & flags</th>
                <th className="px-3 py-2.5 pr-5">Review</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((c) => (
                <tr key={c.id} onClick={() => openPromo(c.id)} className="hover:bg-white/[0.025] cursor-pointer align-top">
                  <td className="px-5 py-3 font-mono text-dim">#{c.rank}</td>
                  <td className="px-3 py-3 max-w-[280px]">
                    <div className="text-white truncate">{c.title}</div>
                    <div className="text-[11.5px] text-mute">
                      Ep {c.episode_number} · {c.provider}
                    </div>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap font-mono text-[12px] text-accent2">
                    {c.start_ts ?? "—"} → {c.end_ts ?? "—"}
                    <div className={cx("text-[11.5px]", c.flags.includes("duration_out_of_range") ? "text-bad" : "text-dim")}>{fmtDur(c.duration_s)}</div>
                  </td>
                  <td className="px-3 py-3 font-semibold tabular-nums" style={{ color: scoreHex(c.overall) }}>
                    {Math.round(c.overall)}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap tabular-nums text-zinc-300 text-[12px]">
                    {Math.round(c.scores.hook_strength)} / {Math.round(c.scores.cliffhanger_strength)} / {Math.round(c.scores.emotional_impact)} / {Math.round(c.scores.standalone_clarity)}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-1 max-w-[360px]">
                      {c.validation_status === "valid" ? <Badge tone="ok">Valid</Badge> : <Badge tone="bad">Invalid</Badge>}
                      {c.flags.map((f) => (
                        <FlagBadge key={f} flag={f} />
                      ))}
                    </div>
                    {c.validation_errors.length > 0 && <div className="text-[11.5px] text-bad/90 mt-1 line-clamp-2 max-w-[360px]">{c.validation_errors.map((e) => e.message).join(" · ")}</div>}
                  </td>
                  <td className="px-3 py-3 pr-5">
                    <ReviewBadge status={c.review_status} />
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-mute">
                    No candidates match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {data && (data.runs.some((r) => r.status === "failed") || data.parse_issues.length > 0) && (
        <div className="grid lg:grid-cols-2 gap-4 mt-4">
          <Card className="animate-fade-up">
            <CardHeader title="AI run log" subtitle="Failed runs are recorded — no fallback results are fabricated" icon={<FileWarning className="size-4" />} />
            <div className="px-5 pb-5 space-y-2 max-h-80 overflow-y-auto scroll-thin">
              {data.runs.map((r) => (
                <div key={r.id} className="text-[12.5px] flex flex-wrap items-center gap-2 border-b border-line pb-2">
                  <Badge tone={r.status === "completed" ? "ok" : r.status === "failed" ? "bad" : "mute"}>{r.status}</Badge>
                  <span className="text-zinc-300">
                    Ep {r.episode_number} · {r.provider}/{r.model} · {r.candidate_count} candidates
                  </span>
                  {r.error && <div className="w-full text-bad">{r.error}</div>}
                </div>
              ))}
            </div>
          </Card>
          <Card className="animate-fade-up">
            <CardHeader title="Parser issues" subtitle="Structure problems found while reading scripts" icon={<FileWarning className="size-4" />} />
            <div className="px-5 pb-5 space-y-3 max-h-80 overflow-y-auto scroll-thin">
              {data.parse_issues.map((p) => (
                <div key={p.filename}>
                  <div className="text-[13px] text-white">
                    Ep {p.episode_number} <span className="font-mono text-mute text-[12px]">{p.filename}</span>
                  </div>
                  {[...p.errors.map((x) => ["bad", x]), ...p.warnings.map((x) => ["warn", x])].map(([t, m], i) => (
                    <div key={i} className={cx("text-[12px]", t === "bad" ? "text-bad" : "text-warn")}>
                      • {m}
                    </div>
                  ))}
                </div>
              ))}
              {data.parse_issues.length === 0 && <div className="text-sm text-ok">All scripts parsed without issues.</div>}
            </div>
          </Card>
        </div>
      )}
      <PromoDrawer promo={open} onClose={() => setOpen(null)} onChanged={() => refresh()} />
    </>
  );
}

function Row({ l, v, bad, warn }: { l: string; v: number; bad?: boolean; warn?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-mute">{l}</span>
      <span className={cx("tabular-nums font-medium", bad ? "text-bad" : warn ? "text-warn" : "text-ok")}>{v}</span>
    </div>
  );
}
