import { Download, FileJson, FileSpreadsheet, Package, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PromoCard, PromoDrawer } from "../components/Promo";
import { Button, Empty, ErrorBox, PageHeader, Select, Skeleton } from "../components/ui";
import { download } from "../lib/api";
import { DIMENSIONS } from "../lib/format";
import { useApi, useStore } from "../lib/store";
import type { Promo } from "../lib/types";

export default function Promos() {
  const { data, error, loading, setData } = useApi<Promo[]>("/api/promos");
  const { toast, refresh } = useStore();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState<Promo | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);

  const episode = params.get("episode") || "";
  const minScore = Number(params.get("min") || 0);
  const review = params.get("review") || "";
  const validity = params.get("validity") || "valid";
  const sort = params.get("sort") || "score";
  const setParam = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    setParams(n, { replace: true });
  };

  const episodes = useMemo(() => [...new Set((data || []).map((p) => p.episode_number))].sort((a, b) => a - b), [data]);
  const list = useMemo(() => {
    let l = (data || []).filter(
      (p) =>
        (!episode || String(p.episode_number) === episode) &&
        p.overall >= minScore &&
        (!review || p.review_status === review) &&
        (validity === "all" || p.validation_status === validity),
    );
    l = [...l];
    if (sort === "score") l.sort((a, b) => b.overall - a.overall);
    else if (sort === "score_asc") l.sort((a, b) => a.overall - b.overall);
    else if (sort === "episode") l.sort((a, b) => a.episode_number - b.episode_number || (a.start_s ?? 0) - (b.start_s ?? 0));
    else if (sort === "duration") l.sort((a, b) => a.duration_s - b.duration_s);
    else {
      const k = sort as keyof Promo["scores"];
      l.sort((a, b) => b.scores[k] - a.scores[k]);
    }
    return l;
  }, [data, episode, minScore, review, validity, sort]);

  const doExport = async (kind: "csv" | "json" | "zip", filtered: boolean) => {
    setExporting(kind + filtered);
    try {
      await download(kind, filtered ? list.map((p) => p.id) : undefined);
      toast("ok", "Export ready", kind === "zip" ? "All raw outputs bundled" : `${filtered ? list.length : "All"} promos exported as ${kind.toUpperCase()}`);
    } catch (e: any) {
      toast("err", "Export failed", e.message);
    } finally {
      setExporting(null);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Promo Discovery"
        title="Ranked promo candidates"
        description="Each recommendation is assembled from original screenplay lines. Timestamps and dialogue are copied from the script — never generated."
        actions={
          <>
            <Button icon={<FileSpreadsheet className="size-4" />} loading={exporting === "csvtrue"} disabled={!list.length} onClick={() => doExport("csv", true)}>
              Export CSV
            </Button>
            <Button icon={<FileJson className="size-4" />} loading={exporting === "jsontrue"} disabled={!list.length} onClick={() => doExport("json", true)}>
              Export JSON
            </Button>
            <Button variant="ghost" icon={<Package className="size-4" />} loading={exporting === "zipfalse"} onClick={() => doExport("zip", false)} title="Parsed episodes, AI raw responses, candidates, ranking, validation errors, evaluation summary">
              All raw outputs
            </Button>
          </>
        }
      />

      <div className="card p-3 flex flex-wrap items-center gap-2.5 mb-5 animate-fade-up">
        <Select value={episode} onChange={(v) => setParam("episode", v)}>
          <option value="">All episodes</option>
          {episodes.map((e) => (
            <option key={e} value={e}>
              Episode {e}
            </option>
          ))}
        </Select>
        <Select value={validity} onChange={(v) => setParam("validity", v === "valid" ? "" : v)}>
          <option value="valid">Valid only</option>
          <option value="invalid">Invalid only</option>
          <option value="all">Valid + invalid</option>
        </Select>
        <Select value={review} onChange={(v) => setParam("review", v)}>
          <option value="">Any review status</option>
          <option value="pending">Pending review</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </Select>
        <div className="flex items-center gap-3 h-10 px-3 rounded-xl border border-line2 bg-white/[0.03]">
          <span className="text-[12.5px] text-mute whitespace-nowrap">Min score</span>
          <input type="range" min={0} max={100} step={5} value={minScore} onChange={(e) => setParam("min", e.target.value === "0" ? "" : e.target.value)} className="w-28 accent-[#8b5cf6]" aria-label="Minimum score" />
          <span className="text-[12.5px] text-white tabular-nums w-6">{minScore}</span>
        </div>
        <Select value={sort} onChange={(v) => setParam("sort", v === "score" ? "" : v)} className="ml-auto">
          <option value="score">Sort: overall score ↓</option>
          <option value="score_asc">Sort: overall score ↑</option>
          {DIMENSIONS.map((d) => (
            <option key={d.key} value={d.key}>
              Sort: {d.label.toLowerCase()} ↓
            </option>
          ))}
          <option value="episode">Sort: episode & time</option>
          <option value="duration">Sort: duration</option>
        </Select>
      </div>

      {error && <ErrorBox message={error} onRetry={refresh} />}
      <div className="text-[12.5px] text-mute mb-3 flex items-center gap-2">
        <Download className="size-3.5" /> {list.length} candidate{list.length === 1 ? "" : "s"} shown · exports include exactly the filtered list
      </div>
      <div className="grid xl:grid-cols-2 gap-3">
        {loading && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-44" />)}
        {list.map((p, i) => (
          <PromoCard key={p.id} p={p} onOpen={() => setOpen(p)} delay={Math.min(i, 10) * 35} />
        ))}
      </div>
      {!loading && list.length === 0 && (
        <div className="card">
          <Empty icon={<Sparkles className="size-6" />} title="No promos match" body={data?.length ? "Loosen the filters to see more candidates." : "Analyse episodes from the Episode Library to discover promos."} />
        </div>
      )}
      <PromoDrawer
        promo={open}
        onClose={() => setOpen(null)}
        onChanged={(np) => setData((d) => (d ? d.map((x) => (x.id === np.id ? np : x)) : d))}
      />
    </>
  );
}
