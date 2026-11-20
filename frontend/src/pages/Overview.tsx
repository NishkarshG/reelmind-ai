import { ArrowRight, Award, CheckCircle2, Clapperboard, Film, Gauge, History, Play, Sparkles, Trophy, Upload } from "lucide-react";
import { useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Link, useNavigate } from "react-router-dom";
import { PromoCard, PromoDrawer } from "../components/Promo";
import { Badge, Button, Card, CardHeader, chartTooltip, Empty, ErrorBox, PageHeader, ScoreRing, Skeleton, Stat } from "../components/ui";
import { fmtSec, timeAgo } from "../lib/format";
import { useApi, useStore } from "../lib/store";
import type { Dashboard, Promo } from "../lib/types";

const KIND_COLORS: Record<string, string> = {
  upload: "#22d3ee",
  analysis: "#8b5cf6",
  review: "#34d399",
  error: "#f87171",
  delete: "#fbbf24",
  settings: "#8b8ba3",
  demo: "#fbbf24",
};

export default function Overview() {
  const { data, error, loading } = useApi<Dashboard>("/api/dashboard");
  const { startAnalysis, workspace, job, refresh } = useStore();
  const [open, setOpen] = useState<Promo | null>(null);
  const nav = useNavigate();
  const running = job && (job.status === "running" || job.status === "queued");

  if (error) return <ErrorBox message={error} onRetry={refresh} />;
  const t = data?.totals;
  const empty = data && t!.episodes === 0;

  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="Promo Intelligence"
        description="Every 20–60 second moment worth cutting — found in the screenplay, validated against original timestamps, and ranked on a transparent editorial rubric."
        actions={
          <>
            <Button icon={<Upload className="size-4" />} onClick={() => nav("/episodes")}>
              Upload scripts
            </Button>
            <Button
              variant="primary"
              icon={<Play className="size-4" />}
              disabled={workspace === "demo" || !t?.episodes || !!running}
              title={workspace === "demo" ? "Analysis is disabled in demo mode" : undefined}
              onClick={() => startAnalysis()}
            >
              {running ? "Analysing…" : "Analyse all episodes"}
            </Button>
          </>
        }
      />

      {empty ? (
        <Card className="grad-border overflow-hidden">
          <Empty
            icon={<Clapperboard className="size-6" />}
            title="Your studio is empty"
            body="Upload a ZIP of screenplay files (or individual .txt scripts). REELMIND parses scenes, dialogue and timestamps, then finds and ranks the strongest promo moments."
            action={
              <div className="flex gap-2 justify-center">
                <Button variant="primary" icon={<Upload className="size-4" />} onClick={() => nav("/episodes")}>
                  Upload screenplays
                </Button>
              </div>
            }
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            {loading || !t ? (
              [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[132px]" />)
            ) : (
              <>
                <Stat label="Episodes uploaded" value={t.episodes} sub={t.failed ? <span className="text-bad">{t.failed} with errors</span> : "All parsed cleanly"} icon={<Film className="size-4" />} accent="#22d3ee" />
                <Stat label="Successfully processed" value={`${t.processed}/${t.episodes}`} sub={`${Math.round((t.processed / Math.max(1, t.episodes)) * 100)}% analysed`} icon={<CheckCircle2 className="size-4" />} accent="#34d399" delay={60} />
                <Stat label="Promo candidates" value={t.candidates} sub={`${t.valid_candidates} passed validation · ${t.approved} approved`} icon={<Sparkles className="size-4" />} accent="#8b5cf6" delay={120} />
                <Stat label="Avg. promo quality" value={t.avg_score != null ? t.avg_score : "—"} sub="Valid candidates, out of 100" icon={<Gauge className="size-4" />} accent="#f472b6" delay={180} />
              </>
            )}
          </div>

          <div className="grid lg:grid-cols-3 gap-4 mt-4">
            <Card className="lg:col-span-2 animate-fade-up">
              <CardHeader title="Promo discovery trend" subtitle="Candidates found and average quality per episode" icon={<Sparkles className="size-4" />} />
              <div className="h-[260px] px-2 pb-4">
                {data && data.trend.length > 0 ? (
                  <ResponsiveContainer>
                    <ComposedChart data={data.trend} margin={{ top: 10, right: 16, left: -10, bottom: 0 }}>
                      <defs>
                        <linearGradient id="gv" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0" stopColor="#8b5cf6" stopOpacity={0.9} />
                          <stop offset="1" stopColor="#8b5cf6" stopOpacity={0.25} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="rgba(255,255,255,.05)" vertical={false} />
                      <XAxis dataKey="episode" stroke="#5c5c74" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis yAxisId="l" stroke="#5c5c74" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                      <YAxis yAxisId="r" orientation="right" domain={[0, 100]} stroke="#5c5c74" fontSize={12} tickLine={false} axisLine={false} />
                      <Tooltip {...chartTooltip} />
                      <Legend wrapperStyle={{ fontSize: 12, color: "#8b8ba3" }} iconType="circle" iconSize={8} />
                      <Bar yAxisId="l" dataKey="valid" name="Valid candidates" fill="url(#gv)" radius={[6, 6, 0, 0]} maxBarSize={38} />
                      <Line yAxisId="r" dataKey="avg_score" name="Avg. score" stroke="#22d3ee" strokeWidth={2.5} dot={{ r: 4, fill: "#09090f", strokeWidth: 2 }} type="monotone" />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <Skeleton className="h-full" />
                )}
              </div>
            </Card>

            <Card className="animate-fade-up relative overflow-hidden">
              <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-accent/15 to-transparent pointer-events-none" />
              <CardHeader title="Top-performing episode" subtitle="Highest average promo score" icon={<Trophy className="size-4" />} />
              {data?.top_episode ? (
                <div className="px-5 pb-5 relative">
                  <div className="flex items-center gap-4">
                    <ScoreRing value={data.top_episode.avg_score ?? 0} size={76} stroke={6} />
                    <div>
                      <div className="text-[34px] font-bold text-white leading-none tracking-tight">Ep {data.top_episode.episode_number}</div>
                      <div className="text-[12px] text-mute mt-1.5">
                        {data.top_episode.valid_promo_count} valid promos · best {Math.round(data.top_episode.best_score ?? 0)}
                      </div>
                    </div>
                  </div>
                  <p className="text-[13px] text-zinc-300 mt-4 leading-relaxed line-clamp-4">{data.top_episode.logline}</p>
                  <div className="flex items-center gap-3 mt-4 text-[12px] text-mute">
                    <span>{data.top_episode.scene_count} scenes</span>·<span>{fmtSec(data.top_episode.duration_s)} runtime</span>
                  </div>
                  <Link to={`/promos?episode=${data.top_episode.episode_number}`} className="mt-4 inline-flex items-center gap-1.5 text-[13px] text-accent2 hover:underline">
                    View its promos <ArrowRight className="size-3.5" />
                  </Link>
                </div>
              ) : (
                <div className="px-5 pb-6 text-sm text-mute">No analysed episodes yet. Run analysis to see the leader.</div>
              )}
            </Card>
          </div>

          <div className="grid lg:grid-cols-3 gap-4 mt-4">
            <Card className="lg:col-span-2 animate-fade-up">
              <CardHeader
                title="Top 5 recommended promos"
                subtitle="Highest-scoring validated candidates"
                icon={<Award className="size-4" />}
                action={
                  <Link to="/promos" className="text-[12.5px] text-mute hover:text-white inline-flex items-center gap-1">
                    All promos <ArrowRight className="size-3.5" />
                  </Link>
                }
              />
              <div className="px-5 pb-5 grid gap-3">
                {loading && [0, 1, 2].map((i) => <Skeleton key={i} className="h-24" />)}
                {data?.top_promos.map((p, i) => (
                  <PromoCard key={p.id} p={p} compact onOpen={() => setOpen(p)} delay={i * 50} />
                ))}
                {data && data.top_promos.length === 0 && <div className="text-sm text-mute py-6 text-center">No validated promos yet — analyse your episodes to discover them.</div>}
              </div>
            </Card>

            <Card className="animate-fade-up">
              <CardHeader title="Recent activity" subtitle="Processing log" icon={<History className="size-4" />} />
              <div className="px-5 pb-5">
                <ol className="relative border-l border-line ml-1.5 space-y-4">
                  {data?.activity.map((a) => (
                    <li key={a.id} className="pl-4 relative">
                      <span className="absolute -left-[5px] top-1.5 size-2.5 rounded-full ring-4 ring-surface" style={{ background: KIND_COLORS[a.kind] || "#8b8ba3" }} />
                      <div className="text-[13px] text-zinc-200 leading-snug">{a.message}</div>
                      <div className="text-[11px] text-dim mt-0.5 flex items-center gap-2">
                        <Badge tone="mute" className="!py-0 !text-[10px]">
                          {a.kind}
                        </Badge>
                        {timeAgo(a.created_at)}
                      </div>
                    </li>
                  ))}
                  {data && data.activity.length === 0 && <li className="pl-4 text-sm text-mute">No activity yet.</li>}
                </ol>
              </div>
            </Card>
          </div>
        </>
      )}
      <PromoDrawer promo={open} onClose={() => setOpen(null)} />
    </>
  );
}

