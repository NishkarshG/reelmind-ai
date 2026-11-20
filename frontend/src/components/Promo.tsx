import { AlertTriangle, Check, Clock, Film, Quote, RotateCcw, Save, ThumbsDown, ThumbsUp, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { patch } from "../lib/api";
import { DIMENSIONS, fmtDur } from "../lib/format";
import { useStore } from "../lib/store";
import type { Promo, ScoreSet } from "../lib/types";
import { Badge, BlockText, Button, cx, Drawer, FlagBadge, ReviewBadge, ScoreBar, ScoreRing } from "./ui";

export function PromoCard({ p, onOpen, compact, delay = 0 }: { p: Promo; onOpen: () => void; compact?: boolean; delay?: number }) {
  const invalid = p.validation_status !== "valid";
  return (
    <button
      onClick={onOpen}
      style={{ animationDelay: `${delay}ms` }}
      className={cx(
        "text-left w-full card p-4 md:p-5 transition-all duration-200 hover:border-white/15 hover:-translate-y-[1px] hover:shadow-[0_12px_40px_-16px_rgb(139_92_246/0.45)] animate-fade-up group",
        invalid && "border-bad/25",
      )}
    >
      <div className="flex gap-4">
        <div className="flex flex-col items-center gap-2">
          <ScoreRing value={p.overall} size={compact ? 48 : 58} />
          <span className="text-[10.5px] font-mono text-dim">#{p.rank}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-1.5">
            <Badge tone="accent">Ep {p.episode_number}</Badge>
            <span className="inline-flex items-center gap-1 text-[11.5px] font-mono text-accent2">
              <Clock className="size-3" />
              {p.start_ts} → {p.end_ts}
            </span>
            <span className="text-[11.5px] text-mute">{fmtDur(p.duration_s)}</span>
            {p.segments.length > 1 && <Badge tone="hot">{p.segments.length} segments</Badge>}
            {invalid && <Badge tone="bad">Invalid</Badge>}
            {p.review_status !== "pending" && <ReviewBadge status={p.review_status} />}
          </div>
          <div className="text-white font-semibold tracking-tight truncate group-hover:text-[#ddd6fe] transition-colors">{p.title}</div>
          <div className="mt-2.5 grid gap-1.5">
            <div className="flex gap-2 text-[13px] min-w-0">
              <span className="text-[10px] uppercase tracking-wider font-bold text-accent mt-0.5 w-12 shrink-0">Hook</span>
              <span className="text-zinc-300 line-clamp-1">
                {p.hook_speaker && <b className="text-zinc-100 font-medium">{p.hook_speaker}: </b>}
                {p.hook_text}
              </span>
            </div>
            {!compact && (
              <div className="flex gap-2 text-[13px] min-w-0">
                <span className="text-[10px] uppercase tracking-wider font-bold text-accent2 mt-0.5 w-12 shrink-0">Cliff</span>
                <span className="text-zinc-300 line-clamp-1">
                  {p.cliffhanger_speaker && <b className="text-zinc-100 font-medium">{p.cliffhanger_speaker}: </b>}
                  {p.cliffhanger_text}
                </span>
              </div>
            )}
          </div>
          {!compact && (
            <div className="mt-3 grid grid-cols-4 gap-2">
              {DIMENSIONS.map((d) => (
                <div key={d.key}>
                  <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(p.scores[d.key] / d.max) * 100}%`, background: d.color }} />
                  </div>
                  <div className="text-[10.5px] text-dim mt-1">
                    {d.short} <span className="text-mute tabular-nums">{Math.round(p.scores[d.key])}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

export function PromoDrawer({ promo, onClose, onChanged }: { promo: Promo | null; onClose: () => void; onChanged?: (p: Promo) => void }) {
  const { toast, workspace, refresh } = useStore();
  const [p, setP] = useState<Promo | null>(promo);
  const [scores, setScores] = useState<ScoreSet | null>(promo?.scores ?? null);
  const [notes, setNotes] = useState(promo?.review_notes ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    setP(promo);
    setScores(promo?.scores ?? null);
    setNotes(promo?.review_notes ?? "");
  }, [promo]);
  if (!p || !scores) return <Drawer open={false} onClose={onClose} title="">{null}</Drawer>;
  const readOnly = workspace === "demo";
  const dirty = DIMENSIONS.some((d) => scores[d.key] !== p.scores[d.key]) || (notes ?? "") !== (p.review_notes ?? "");
  const total = DIMENSIONS.reduce((a, d) => a + Number(scores[d.key] || 0), 0);

  const save = async (body: Record<string, unknown>, label: string) => {
    setBusy(label);
    try {
      const np = await patch<Promo>(`/api/promos/${p.id}`, body);
      setP(np);
      setScores(np.scores);
      setNotes(np.review_notes ?? "");
      onChanged?.(np);
      refresh();
      toast("ok", label === "scores" ? "Scores saved" : `Promo ${np.review_status}`, `#${np.id} · new overall ${Math.round(np.overall)}`);
    } catch (e: any) {
      toast("err", "Update failed", e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Drawer
      open={!!promo}
      onClose={onClose}
      title={p.title}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          Episode {p.episode_number} · {p.start_ts} → {p.end_ts} · {fmtDur(p.duration_s)} · rank #{p.rank}
        </span>
      }
    >
      <div className="p-6 space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          {p.validation_status === "valid" ? <Badge tone="ok" dot>Validated against screenplay</Badge> : <Badge tone="bad" dot>Failed validation</Badge>}
          <ReviewBadge status={p.review_status} />
          {p.flags.map((f) => (
            <FlagBadge key={f} flag={f} />
          ))}
          <Badge tone="mute">
            {p.provider} · {p.model}
          </Badge>
        </div>

        {p.validation_errors?.length > 0 && (
          <div className="rounded-xl border border-bad/25 bg-bad/[0.05] p-4">
            <div className="flex items-center gap-2 text-bad text-sm font-medium mb-2">
              <AlertTriangle className="size-4" /> Validation errors (kept for evaluation, not removed)
            </div>
            <ul className="space-y-1 text-[13px] text-zinc-300 list-disc pl-5">
              {p.validation_errors.map((e, i) => (
                <li key={i}>
                  <span className="font-mono text-[11px] text-bad/80 mr-1">{e.code}</span>
                  {e.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-3">
          <QuoteCard tone="accent" label="Opening hook" id={p.hook_line} speaker={p.hook_speaker} text={p.hook_text} />
          <QuoteCard tone="cyan" label="Cliffhanger" id={p.cliffhanger_line} speaker={p.cliffhanger_speaker} text={p.cliffhanger_text} />
        </div>

        <section>
          <h4 className="text-[12px] uppercase tracking-[0.14em] text-dim font-semibold mb-2">Why this promo</h4>
          <p className="text-[14px] text-zinc-300 leading-relaxed">{p.explanation || "—"}</p>
          {p.patterns?.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {p.patterns.map((x) => (
                <Badge key={x} tone="hot">
                  {x}
                </Badge>
              ))}
            </div>
          )}
        </section>

        <section className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h4 className="text-white font-semibold text-sm">Editorial score breakdown</h4>
              <p className="text-[12px] text-mute">Promo-potential judgement, not a virality prediction. Drag to adjust.</p>
            </div>
            <ScoreRing value={total} size={54} />
          </div>
          <div className="space-y-4">
            {DIMENSIONS.map((d) => {
              const edited = p.editor_scores && p.editor_scores[d.key] != null;
              return (
                <div key={d.key}>
                  <ScoreBar label={d.label} value={Number(scores[d.key])} max={d.max} color={d.color} edited={!!edited} />
                  <div className="flex items-center gap-3 mt-1.5">
                    <input
                      type="range"
                      min={0}
                      max={d.max}
                      step={1}
                      disabled={readOnly}
                      value={scores[d.key]}
                      onChange={(e) => setScores({ ...scores, [d.key]: Number(e.target.value) })}
                      className="flex-1 accent-[#8b5cf6] disabled:opacity-40"
                      aria-label={d.label}
                    />
                    <span className="text-[11px] text-dim w-20 text-right">AI: {Math.round(p.ai_scores[d.key])}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <textarea
            value={notes ?? ""}
            disabled={readOnly}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Editor notes (optional)…"
            className="mt-4 w-full min-h-20 rounded-xl bg-white/[0.03] border border-line2 p-3 text-sm text-zinc-200 placeholder:text-dim outline-none focus:border-accent/60 disabled:opacity-50"
          />
          <div className="flex flex-wrap gap-2 mt-3">
            <Button
              variant="primary"
              size="sm"
              icon={<Save className="size-3.5" />}
              disabled={readOnly || !dirty}
              loading={busy === "scores"}
              onClick={() => save({ editor_scores: scores, review_notes: notes }, "scores")}
            >
              Save adjustments
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<RotateCcw className="size-3.5" />}
              disabled={readOnly || !p.editor_scores || Object.keys(p.editor_scores).length === 0}
              loading={busy === "reset"}
              onClick={() => save({ editor_scores: {} }, "scores")}
            >
              Reset to AI scores
            </Button>
          </div>
          {readOnly && <p className="text-[12px] text-warn mt-3">Demo data is read-only. Switch to the Live workspace to review promos.</p>}
        </section>

        <section>
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-[12px] uppercase tracking-[0.14em] text-dim font-semibold">Clip edit list — original screenplay</h4>
            <Link to={`/scenes?episode=${p.episode_id}&promo=${p.id}`} className="text-[12px] text-accent2 hover:underline inline-flex items-center gap-1">
              <Film className="size-3.5" /> View on timeline
            </Link>
          </div>
          <div className="space-y-4">
            {p.segments.map((s, i) => (
              <div key={i} className="rounded-xl border border-line overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2 bg-white/[0.03] border-b border-line text-[12px]">
                  <span className="text-zinc-300 font-medium">Segment {i + 1}</span>
                  <span className="font-mono text-accent2">
                    {s.start} → {s.end} <span className="text-dim">({fmtDur(s.duration_s)})</span>
                  </span>
                </div>
                <div className="divide-y divide-line">
                  {s.lines.map((l) => (
                    <div key={l.id} className={cx("px-4 py-2.5 flex gap-3 text-[13px]", l.id === p.hook_line && "bg-accent/[0.07]", l.id === p.cliffhanger_line && "bg-accent2/[0.07]")}>
                      <span className="font-mono text-[11px] text-dim w-[118px] shrink-0 pt-0.5">
                        {l.start}–{l.end}
                      </span>
                      <span className="min-w-0">
                        {l.kind === "dialogue" ? (
                          <>
                            <b className="text-white font-semibold text-[12px] tracking-wide">{l.character}</b>
                            <span className="text-zinc-300 ml-2">{l.text}</span>
                          </>
                        ) : (
                          <BlockText kind={l.kind} text={l.text} />
                        )}
                        {l.id === p.hook_line && <Badge tone="accent" className="ml-2">hook</Badge>}
                        {l.id === p.cliffhanger_line && <Badge tone="info" className="ml-2">cliffhanger</Badge>}
                      </span>
                    </div>
                  ))}
                  {s.lines.length === 0 && <div className="px-4 py-3 text-[13px] text-bad">Referenced lines {s.start_line_id}–{s.end_line_id} were not found in the screenplay.</div>}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="sticky bottom-0 glass border-t border-line px-6 py-4 flex flex-wrap gap-2 justify-end">
        <Button variant="ghost" disabled={readOnly || p.review_status === "pending"} loading={busy === "pending"} onClick={() => save({ review_status: "pending" }, "pending")}>
          Reset review
        </Button>
        <Button variant="danger" icon={<ThumbsDown className="size-4" />} disabled={readOnly || p.review_status === "rejected"} loading={busy === "rejected"} onClick={() => save({ review_status: "rejected" }, "rejected")}>
          Reject
        </Button>
        <Button variant="success" icon={p.review_status === "approved" ? <Check className="size-4" /> : <ThumbsUp className="size-4" />} disabled={readOnly || p.review_status === "approved"} loading={busy === "approved"} onClick={() => save({ review_status: "approved" }, "approved")}>
          {p.review_status === "approved" ? "Approved" : "Approve"}
        </Button>
      </div>
    </Drawer>
  );
}

function QuoteCard({ tone, label, id, speaker, text }: { tone: "accent" | "cyan"; label: string; id: string | null; speaker: string | null; text: string }) {
  return (
    <div className={cx("rounded-xl border p-4 relative overflow-hidden", tone === "accent" ? "border-accent/25 bg-accent/[0.05]" : "border-accent2/25 bg-accent2/[0.05]")}>
      <div className="flex items-center justify-between mb-2">
        <span className={cx("text-[10.5px] uppercase tracking-[0.16em] font-bold flex items-center gap-1.5", tone === "accent" ? "text-accent" : "text-accent2")}>
          {tone === "accent" ? <Zap className="size-3.5" /> : <Quote className="size-3.5" />} {label}
        </span>
        <span className="font-mono text-[10.5px] text-dim">{id}</span>
      </div>
      {speaker && <div className="text-[12px] font-semibold text-white tracking-wide">{speaker}</div>}
      <p className={cx("text-[14px] leading-relaxed", speaker ? "text-zinc-200" : "text-zinc-300 italic")}>{text || "—"}</p>
    </div>
  );
}
