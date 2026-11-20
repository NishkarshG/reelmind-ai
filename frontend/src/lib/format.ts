export const fmtSec = (s: number | null | undefined) => {
  if (s == null || isNaN(s)) return "—";
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
};

export const fmtDur = (s: number | null | undefined) => (s == null ? "—" : `${Math.round(s * 10) / 10}s`);

export const timeAgo = (iso: string) => {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
};

export const scoreTone = (v: number) => (v >= 80 ? "text-ok" : v >= 65 ? "text-accent2" : v >= 50 ? "text-warn" : "text-bad");
export const scoreHex = (v: number) => (v >= 80 ? "#34d399" : v >= 65 ? "#22d3ee" : v >= 50 ? "#fbbf24" : "#f87171");

export const DIMENSIONS = [
  { key: "hook_strength", label: "Hook strength", short: "Hook", max: 30, color: "#8b5cf6" },
  { key: "cliffhanger_strength", label: "Cliffhanger strength", short: "Cliff", max: 30, color: "#22d3ee" },
  { key: "emotional_impact", label: "Emotional impact", short: "Emotion", max: 20, color: "#f472b6" },
  { key: "standalone_clarity", label: "Standalone clarity", short: "Clarity", max: 20, color: "#34d399" },
] as const;

export const FLAG_LABELS: Record<string, { label: string; tone: string }> = {
  invalid_timestamp: { label: "Invalid timestamp", tone: "bad" },
  duration_out_of_range: { label: "Duration out of range", tone: "bad" },
  unverified_excerpt: { label: "Unverified excerpt", tone: "bad" },
  weak_hook: { label: "Weak hook", tone: "warn" },
  weak_cliffhanger: { label: "Weak cliffhanger", tone: "warn" },
  potentially_confusing: { label: "Potentially confusing", tone: "warn" },
};

export const STATUS_META: Record<string, { label: string; tone: string }> = {
  parsed: { label: "Parsed", tone: "info" },
  parse_error: { label: "Parse error", tone: "bad" },
  queued: { label: "Queued", tone: "mute" },
  analyzing: { label: "Analysing", tone: "accent" },
  analyzed: { label: "Analysed", tone: "ok" },
  analysis_failed: { label: "Analysis failed", tone: "bad" },
};
