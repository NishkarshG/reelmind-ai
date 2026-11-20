import { Clapperboard, Flame, MessageSquare, MousePointerClick, Quote, Video, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PromoDrawer } from "../components/Promo";
import { Badge, Card, CardHeader, cx, Empty, PageHeader, Select, Skeleton } from "../components/ui";
import { fmtSec, scoreHex } from "../lib/format";
import { useApi } from "../lib/store";
import type { Element, EpisodeDetail, EpisodeSummary, Promo } from "../lib/types";

type Marker = { kind: "hook" | "cliff" | "peak"; el: Element; promos: Promo[] };

const SCENE_COLORS = ["#8b5cf6", "#22d3ee", "#f472b6", "#34d399", "#fbbf24", "#60a5fa"];

export default function Scenes() {
  const [params, setParams] = useSearchParams();
  const { data: eps } = useApi<EpisodeSummary[]>("/api/episodes");
  const epId = params.get("episode") || (eps && eps[0] ? String(eps[0].id) : "");
  const { data: ep, loading } = useApi<EpisodeDetail>(epId ? `/api/episodes/${epId}` : null, [epId]);
  const [selected, setSelected] = useState<string | null>(null);
  const [hoverPromo, setHoverPromo] = useState<number | null>(params.get("promo") ? Number(params.get("promo")) : null);
  const [open, setOpen] = useState<Promo | null>(null);
  const [lanes, setLanes] = useState({ dialogue: true, action: true, signals: true });

  useEffect(() => setSelected(null), [epId]);
  const current = ep && String(ep.id) === epId ? ep : null;

  const model = useMemo(() => {
    if (!current) return null;
    const els = current.parsed.scenes.flatMap((s) => s.elements).filter((e) => e.start_s != null && e.end_s != null);
    const dur = Math.max(current.duration_s || 0, ...els.map((e) => e.end_s!), 1);
    const valid = current.promos.filter((p) => p.validation_status === "valid");
    // promo heat: how strongly each line is covered by validated candidates, weighted by emotional impact
    const heat: Record<string, number> = {};
    for (const p of valid)
      for (const s of p.segments) for (const l of s.lines) heat[l.id] = (heat[l.id] || 0) + (p.scores.emotional_impact / 20) * (p.overall / 100);
    const maxHeat = Math.max(0.0001, ...Object.values(heat));
    const markers = new Map<string, Marker>();
    const add = (kind: Marker["kind"], id: string | null, p?: Promo) => {
      if (!id) return;
      const el = els.find((e) => e.id === id);
      if (!el) return;
      const key = kind + id;
      const m = markers.get(key) || { kind, el, promos: [] };
      if (p) m.promos.push(p);
      markers.set(key, m);
    };
    valid.forEach((p) => {
      add("hook", p.hook_line, p);
      add("cliff", p.cliffhanger_line, p);
    });
    // emotional peaks = top local maxima of heat
    const peaks = els
      .filter((e, i) => (heat[e.id] || 0) > 0 && (heat[e.id] || 0) >= (heat[els[i - 1]?.id] || 0) && (heat[e.id] || 0) >= (heat[els[i + 1]?.id] || 0))
      .sort((a, b) => (heat[b.id] || 0) - (heat[a.id] || 0))
      .slice(0, 3);
    peaks.forEach((e) => add("peak", e.id));
    return { els, dur, heat, maxHeat, markers: [...markers.values()], valid };
  }, [current]);

  const selEl = model?.els.find((e) => e.id === selected) || null;
  const selCtx = useMemo(() => {
    if (!model || !selEl) return [];
    const i = model.els.findIndex((e) => e.id === selEl.id);
    return model.els.slice(Math.max(0, i - 2), i + 3);
  }, [model, selEl]);
  const selMarkers = model?.markers.filter((m) => m.el.id === selected) || [];
  const hp = model?.valid.find((p) => p.id === hoverPromo) || null;
  const pct = (s: number) => `${(s / (model?.dur || 1)) * 100}%`;

  return (
    <>
      <PageHeader
        eyebrow="Scene Intelligence"
        title="Episode timeline"
        description="Scene boundaries, dialogue and action beats on the original timecode, with the hooks, cliffhangers and emotional peaks surfaced by analysis. Click any marker to read the screenplay excerpt."
        actions={
          <Select value={epId} onChange={(v) => setParams({ episode: v })} className="min-w-[220px]">
            {(eps || []).map((e) => (
              <option key={e.id} value={e.id}>
                Episode {e.episode_number} — {e.scene_count} scenes
              </option>
            ))}
          </Select>
        }
      />

      {eps && eps.length === 0 && (
        <Card>
          <Empty icon={<Clapperboard className="size-6" />} title="No episodes yet" body="Upload screenplays to explore their timelines." />
        </Card>
      )}
      {(loading || (!model && eps && eps.length > 0)) && <Skeleton className="h-[380px]" />}

      {model && current && (
        <>
          <Card className="p-5 md:p-6 animate-fade-up overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
              <div className="min-w-0">
                <div className="text-white font-semibold">
                  Episode {current.episode_number} <span className="text-mute font-normal">· {fmtSec(model.dur)} · {current.parsed.scenes.length} scenes · {model.els.length} timed beats</span>
                </div>
                <div className="text-[12.5px] text-mute line-clamp-1 mt-0.5">{current.logline}</div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(["dialogue", "action", "signals"] as const).map((k) => (
                  <button key={k} onClick={() => setLanes({ ...lanes, [k]: !lanes[k] })} className={cx("h-7 px-2.5 rounded-lg text-[12px] border transition", lanes[k] ? "border-accent/40 bg-accent/15 text-white" : "border-line2 text-mute hover:text-white")}>
                    {k[0].toUpperCase() + k.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto scroll-thin -mx-1 px-1">
              <div className="min-w-[720px]">
                {/* time ruler */}
                <div className="relative h-5 ml-[92px] text-[10.5px] font-mono text-dim">
                  {Array.from({ length: Math.floor(model.dur / 15) + 1 }, (_, i) => i * 15).map((t) => (
                    <span key={t} className="absolute -translate-x-1/2" style={{ left: pct(t) }}>
                      {fmtSec(t)}
                    </span>
                  ))}
                </div>

                <Lane label="Scenes">
                  {current.parsed.scenes.map((s, i) =>
                    s.start_s != null && s.end_s != null ? (
                      <div
                        key={s.number}
                        className="absolute top-1 bottom-1 rounded-lg border px-2 flex flex-col justify-center overflow-hidden group"
                        style={{ left: pct(s.start_s), width: `calc(${pct(s.end_s - s.start_s)} - 3px)`, background: `${SCENE_COLORS[i % 6]}1f`, borderColor: `${SCENE_COLORS[i % 6]}55` }}
                        title={`${s.heading}\n${s.start} → ${s.end}`}
                      >
                        <span className="text-[10.5px] font-bold tracking-wider" style={{ color: SCENE_COLORS[i % 6] }}>
                          SCENE {s.number}
                        </span>
                        <span className="text-[11px] text-zinc-300 truncate">{s.heading}</span>
                        <span className="text-[10px] font-mono text-dim">
                          {s.start}–{s.end}
                        </span>
                      </div>
                    ) : null,
                  )}
                  {hp &&
                    hp.segments.map((s, i) =>
                      s.start_s != null && s.end_s != null ? (
                        <div key={i} className="absolute -top-1 -bottom-1 rounded-lg border-2 border-white/80 shadow-[0_0_24px_rgb(255_255_255/0.25)] pointer-events-none" style={{ left: pct(s.start_s), width: pct(s.end_s - s.start_s) }} />
                      ) : null,
                    )}
                </Lane>

                {lanes.dialogue && (
                  <Lane label="Dialogue" icon={<MessageSquare className="size-3" />}>
                    {model.els
                      .filter((e) => e.kind === "dialogue")
                      .map((e) => (
                        <Beat key={e.id} e={e} pct={pct} active={selected === e.id} color="#c4b5fd" onClick={() => setSelected(e.id)} />
                      ))}
                  </Lane>
                )}
                {lanes.action && (
                  <Lane label="Action" icon={<Video className="size-3" />}>
                    {model.els
                      .filter((e) => e.kind === "action")
                      .map((e) => (
                        <Beat key={e.id} e={e} pct={pct} active={selected === e.id} color="#67e8f9" onClick={() => setSelected(e.id)} />
                      ))}
                  </Lane>
                )}
                {lanes.signals && (
                  <>
                    <Lane label="Promo heat" icon={<Flame className="size-3" />} h="h-8">
                      {model.els.map((e) => {
                        const v = (model.heat[e.id] || 0) / model.maxHeat;
                        return (
                          <div
                            key={e.id}
                            onClick={() => setSelected(e.id)}
                            className="absolute bottom-1 rounded-sm cursor-pointer hover:brightness-125"
                            style={{ left: pct(e.start_s!), width: `calc(${pct(e.end_s! - e.start_s!)} - 1px)`, height: `${8 + v * 80}%`, background: `linear-gradient(180deg, rgba(244,114,182,${0.25 + v * 0.75}), rgba(139,92,246,${0.15 + v * 0.5}))` }}
                            title={`${e.id} · heat ${Math.round(v * 100)}%`}
                          />
                        );
                      })}
                    </Lane>
                    <Lane label="Signals" icon={<Zap className="size-3" />} h="h-12">
                      {model.markers.map((m) => {
                        const offset = m.kind === "hook" ? "top-1" : m.kind === "cliff" ? "top-[18px]" : "top-[34px]";
                        const c = m.kind === "hook" ? "#8b5cf6" : m.kind === "cliff" ? "#22d3ee" : "#f472b6";
                        return (
                          <button
                            key={m.kind + m.el.id}
                            onClick={() => setSelected(m.el.id)}
                            className={cx("absolute size-3 rotate-45 rounded-[3px] -translate-x-1/2 transition-transform hover:scale-150", offset, selected === m.el.id && "scale-150 ring-2 ring-white")}
                            style={{ left: pct(m.kind === "cliff" ? m.el.end_s! - 0.5 : m.el.start_s! + 0.5), background: c, boxShadow: `0 0 10px ${c}` }}
                            title={`${m.kind === "hook" ? "Hook" : m.kind === "cliff" ? "Cliffhanger" : "Emotional peak"} · ${m.el.id} · ${m.el.start}`}
                            aria-label={`${m.kind} marker ${m.el.id}`}
                          />
                        );
                      })}
                    </Lane>
                  </>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-4 mt-4 text-[11.5px] text-mute">
              <Legend c="#c4b5fd" l="Dialogue beat" />
              <Legend c="#67e8f9" l="Action beat" />
              <Legend c="#8b5cf6" l="Hook" d />
              <Legend c="#22d3ee" l="Cliffhanger" d />
              <Legend c="#f472b6" l="Emotional peak (highest promo heat)" d />
              <span className="inline-flex items-center gap-1.5">
                <span className="w-4 h-2.5 rounded border-2 border-white/80" /> Hovered promo
              </span>
            </div>
          </Card>

          <div className="grid lg:grid-cols-5 gap-4 mt-4">
            <Card className="lg:col-span-3 animate-fade-up">
              <CardHeader title="Screenplay excerpt" subtitle={selEl ? `${selEl.id} · Scene ${selEl.scene_number} · ${selEl.start} → ${selEl.end}` : "Click a beat or marker on the timeline"} icon={<Quote className="size-4" />} />
              <div className="px-5 pb-5">
                {!selEl ? (
                  <div className="flex flex-col items-center py-10 text-mute text-sm gap-2">
                    <MousePointerClick className="size-6 text-dim" /> Select a marker to read the original lines in context.
                  </div>
                ) : (
                  <>
                    {selMarkers.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {selMarkers.map((m) => (
                          <Badge key={m.kind} tone={m.kind === "hook" ? "accent" : m.kind === "cliff" ? "info" : "hot"}>
                            {m.kind === "hook" ? `Hook in ${m.promos.length} promo(s)` : m.kind === "cliff" ? `Cliffhanger in ${m.promos.length} promo(s)` : "Emotional peak"}
                          </Badge>
                        ))}
                      </div>
                    )}
                    <div className="rounded-xl border border-line bg-black/25 divide-y divide-line overflow-hidden font-mono text-[12.5px]">
                      {selCtx.map((e) => (
                        <button key={e.id} onClick={() => setSelected(e.id)} className={cx("w-full text-left px-4 py-3 flex gap-3 transition", e.id === selEl.id ? "bg-accent/[0.12]" : "opacity-60 hover:opacity-100")}>
                          <span className="text-dim w-9 shrink-0">{e.id}</span>
                          <span className="whitespace-pre-wrap text-zinc-200 min-w-0">{e.raw.trim()}</span>
                        </button>
                      ))}
                    </div>
                    <div className="text-[11.5px] text-dim mt-2">Shown verbatim from source file line {selEl.source_line}.</div>
                  </>
                )}
              </div>
            </Card>
            <Card className="lg:col-span-2 animate-fade-up">
              <CardHeader title="Promos in this episode" subtitle="Hover to outline on the timeline, click to open" icon={<Zap className="size-4" />} />
              <div className="px-3 pb-4 space-y-1 max-h-[420px] overflow-y-auto scroll-thin">
                {model.valid.length === 0 && <div className="px-2 py-6 text-sm text-mute text-center">No validated promos yet for this episode.</div>}
                {model.valid
                  .slice()
                  .sort((a, b) => b.overall - a.overall)
                  .map((p) => (
                    <button
                      key={p.id}
                      onMouseEnter={() => setHoverPromo(p.id)}
                      onFocus={() => setHoverPromo(p.id)}
                      onClick={() => setOpen(p)}
                      className={cx("w-full text-left rounded-xl px-3 py-2.5 flex items-center gap-3 transition border", hoverPromo === p.id ? "bg-white/[0.05] border-line2" : "border-transparent hover:bg-white/[0.03]")}
                    >
                      <span className="text-[15px] font-semibold tabular-nums w-8" style={{ color: scoreHex(p.overall) }}>
                        {Math.round(p.overall)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] text-white truncate">{p.title}</span>
                        <span className="block text-[11.5px] font-mono text-accent2">
                          {p.start_ts} → {p.end_ts}
                        </span>
                      </span>
                    </button>
                  ))}
              </div>
            </Card>
          </div>
        </>
      )}
      <PromoDrawer promo={open} onClose={() => setOpen(null)} />
    </>
  );
}

function Lane({ label, icon, children, h = "h-14" }: { label: string; icon?: React.ReactNode; children: React.ReactNode; h?: string }) {
  return (
    <div className="flex items-stretch gap-3 mt-2">
      <div className="w-[80px] shrink-0 text-[11px] text-mute flex items-center gap-1.5">
        {icon}
        {label}
      </div>
      <div className={cx("relative flex-1 rounded-xl bg-white/[0.02] border border-line", h)}>{children}</div>
    </div>
  );
}

function Beat({ e, pct, active, color, onClick }: { e: Element; pct: (s: number) => string; active: boolean; color: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cx("absolute top-2 bottom-2 rounded-md transition-all hover:brightness-150 hover:-translate-y-px", active && "ring-2 ring-white z-10")}
      style={{ left: pct(e.start_s!), width: `max(4px, calc(${pct(Math.max(0.3, e.end_s! - e.start_s!))} - 2px))`, background: `${color}55`, borderLeft: `2px solid ${color}` }}
      title={`${e.id} ${e.start}–${e.end}\n${e.character ? e.character + ": " : ""}${e.text}`}
      aria-label={`${e.kind} ${e.id}`}
    />
  );
}

function Legend({ c, l, d }: { c: string; l: string; d?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cx(d ? "size-2.5 rotate-45 rounded-[2px]" : "w-4 h-2.5 rounded")} style={{ background: c }} />
      {l}
    </span>
  );
}
