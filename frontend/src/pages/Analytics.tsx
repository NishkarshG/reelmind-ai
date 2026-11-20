import { BarChart3, GitCompare, Layers, PieChart as PieIcon, Radar as RadarIcon, ScatterChart as ScatterIcon } from "lucide-react";
import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { Card, CardHeader, chartTooltip, cx, Empty, ErrorBox, PageHeader, Skeleton } from "../components/ui";
import { DIMENSIONS } from "../lib/format";
import { useApi, useStore } from "../lib/store";

interface Analytics {
  distribution: { range: string; count: number }[];
  episode_comparison: { episode: string; episode_number: number; count: number; best: number; avg: number; hook: number; cliffhanger: number; emotion: number; clarity: number }[];
  patterns: { pattern: string; count: number }[];
  hook_vs_cliffhanger: { id: number; episode: number; hook: number; cliffhanger: number; overall: number; title: string }[];
  dimension_averages: Record<string, number>;
  review: Record<string, number>;
}

const axis = { stroke: "#5c5c74", fontSize: 12, tickLine: false, axisLine: false } as const;
const DIST_COLORS = ["#f87171", "#fb923c", "#fbbf24", "#a3e635", "#22d3ee", "#8b5cf6", "#c084fc"];

export default function Analytics() {
  const { data, error, loading } = useApi<Analytics>("/api/analytics");
  const { refresh } = useStore();
  const [metric, setMetric] = useState<"avg" | "best" | "count">("avg");
  if (error) return <ErrorBox message={error} onRetry={refresh} />;
  const empty = data && data.hook_vs_cliffhanger.length === 0;
  const radar = data ? DIMENSIONS.map((d) => ({ dim: d.short, pct: Math.round(((data.dimension_averages[d.key] || 0) / d.max) * 100), raw: data.dimension_averages[d.key], max: d.max })) : [];

  return (
    <>
      <PageHeader eyebrow="Analytics" title="Promo performance analytics" description="How promo potential is distributed across the season, and which dramatic patterns the engine keeps finding. All figures use validated candidates and editor-adjusted scores." />
      {loading && <div className="grid lg:grid-cols-2 gap-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[320px]" />)}</div>}
      {empty && (
        <Card>
          <Empty icon={<BarChart3 className="size-6" />} title="No analysed promos yet" body="Run analysis on your episodes to populate analytics." />
        </Card>
      )}
      {data && !empty && (
        <div className="grid lg:grid-cols-2 gap-4">
          <Card className="animate-fade-up">
            <CardHeader title="Promo quality distribution" subtitle="Number of valid candidates per overall-score band" icon={<BarChart3 className="size-4" />} />
            <div className="h-[280px] px-2 pb-4">
              <ResponsiveContainer>
                <BarChart data={data.distribution} margin={{ top: 10, right: 16, left: -16, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(255,255,255,.05)" vertical={false} />
                  <XAxis dataKey="range" {...axis} />
                  <YAxis {...axis} allowDecimals={false} />
                  <Tooltip {...chartTooltip} />
                  <Bar dataKey="count" name="Candidates" radius={[6, 6, 0, 0]} maxBarSize={44}>
                    {data.distribution.map((_, i) => (
                      <Cell key={i} fill={DIST_COLORS[i]} fillOpacity={0.85} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="animate-fade-up">
            <CardHeader
              title="Episode-wise promo comparison"
              subtitle="Compare episodes by promo potential"
              icon={<GitCompare className="size-4" />}
              action={
                <div className="flex rounded-lg border border-line2 p-0.5 text-[11.5px]">
                  {(["avg", "best", "count"] as const).map((m) => (
                    <button key={m} onClick={() => setMetric(m)} className={cx("px-2.5 h-7 rounded-md transition", metric === m ? "bg-accent/25 text-white" : "text-mute hover:text-white")}>
                      {m === "avg" ? "Average" : m === "best" ? "Best" : "Count"}
                    </button>
                  ))}
                </div>
              }
            />
            <div className="h-[280px] px-2 pb-4">
              <ResponsiveContainer>
                <BarChart data={data.episode_comparison} margin={{ top: 10, right: 16, left: -16, bottom: 0 }}>
                  <defs>
                    <linearGradient id="ga" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor="#22d3ee" />
                      <stop offset="1" stopColor="#8b5cf6" stopOpacity={0.6} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(255,255,255,.05)" vertical={false} />
                  <XAxis dataKey="episode" {...axis} />
                  <YAxis {...axis} domain={metric === "count" ? [0, "auto"] : [0, 100]} allowDecimals={false} />
                  <Tooltip {...chartTooltip} />
                  <Bar dataKey={metric} name={metric === "avg" ? "Average score" : metric === "best" ? "Best score" : "Valid promos"} fill="url(#ga)" radius={[6, 6, 0, 0]} maxBarSize={44} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="animate-fade-up">
            <CardHeader title="Hook vs cliffhanger" subtitle="Each dot is a promo; size = overall score. Top-right is the sweet spot." icon={<ScatterIcon className="size-4" />} />
            <div className="h-[300px] px-2 pb-4">
              <ResponsiveContainer>
                <ScatterChart margin={{ top: 10, right: 20, left: -10, bottom: 10 }}>
                  <CartesianGrid stroke="rgba(255,255,255,.05)" />
                  <XAxis type="number" dataKey="hook" name="Hook" domain={[0, 30]} {...axis} label={{ value: "Hook strength /30", position: "insideBottom", offset: -4, fill: "#5c5c74", fontSize: 11 }} />
                  <YAxis type="number" dataKey="cliffhanger" name="Cliffhanger" domain={[0, 30]} {...axis} />
                  <ZAxis type="number" dataKey="overall" range={[40, 260]} name="Overall" />
                  <Tooltip {...chartTooltip} cursor={{ strokeDasharray: "3 3", stroke: "#5c5c74" }} formatter={(v: any) => Math.round(Number(v) * 10) / 10} />
                  <Scatter data={data.hook_vs_cliffhanger} fill="#8b5cf6" fillOpacity={0.75} stroke="#c4b5fd" />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="animate-fade-up">
            <CardHeader title="Hook & cliffhanger by episode" subtitle="Average dimension scores per episode" icon={<Layers className="size-4" />} />
            <div className="h-[300px] px-2 pb-4">
              <ResponsiveContainer>
                <BarChart data={data.episode_comparison} margin={{ top: 10, right: 16, left: -16, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(255,255,255,.05)" vertical={false} />
                  <XAxis dataKey="episode" {...axis} />
                  <YAxis {...axis} domain={[0, 30]} />
                  <Tooltip {...chartTooltip} />
                  <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
                  <Bar dataKey="hook" name="Hook /30" fill="#8b5cf6" radius={[5, 5, 0, 0]} maxBarSize={22} />
                  <Bar dataKey="cliffhanger" name="Cliffhanger /30" fill="#22d3ee" radius={[5, 5, 0, 0]} maxBarSize={22} />
                  <Bar dataKey="emotion" name="Emotion /20" fill="#f472b6" radius={[5, 5, 0, 0]} maxBarSize={22} />
                  <Bar dataKey="clarity" name="Clarity /20" fill="#34d399" radius={[5, 5, 0, 0]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="animate-fade-up">
            <CardHeader title="Most common dramatic patterns" subtitle="Tags attached to validated candidates" icon={<PieIcon className="size-4" />} />
            <div className="px-5 pb-5 space-y-2.5">
              {data.patterns.length === 0 && <div className="text-sm text-mute">No patterns tagged.</div>}
              {data.patterns.map((p, i) => {
                const max = data.patterns[0].count;
                return (
                  <div key={p.pattern} className="group">
                    <div className="flex justify-between text-[13px] mb-1">
                      <span className="text-zinc-200">{p.pattern}</span>
                      <span className="text-mute tabular-nums">{p.count}</span>
                    </div>
                    <div className="h-2 rounded-full bg-white/[0.05] overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700 group-hover:brightness-125"
                        style={{ width: `${(p.count / max) * 100}%`, background: `linear-gradient(90deg, ${["#8b5cf6", "#22d3ee", "#f472b6", "#34d399"][i % 4]}, transparent 180%)` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className="animate-fade-up">
            <CardHeader title="Scoring profile" subtitle="Season-wide average per dimension (% of max)" icon={<RadarIcon className="size-4" />} />
            <div className="h-[300px] px-2 pb-4">
              <ResponsiveContainer>
                <RadarChart data={radar} outerRadius="72%">
                  <PolarGrid stroke="rgba(255,255,255,.08)" />
                  <PolarAngleAxis dataKey="dim" tick={{ fill: "#8b8ba3", fontSize: 12 }} />
                  <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                  <Tooltip {...chartTooltip} formatter={(v: any, _n: any, p: any) => [`${v}% (${p.payload.raw}/${p.payload.max})`, "Average"]} />
                  <Radar dataKey="pct" stroke="#22d3ee" fill="#8b5cf6" fillOpacity={0.35} strokeWidth={2} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
