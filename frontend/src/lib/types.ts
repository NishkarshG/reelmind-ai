export type Workspace = "live" | "demo";

export interface ScoreSet {
  hook_strength: number;
  cliffhanger_strength: number;
  emotional_impact: number;
  standalone_clarity: number;
}

export interface Element {
  id: string;
  kind: "dialogue" | "action" | "camera" | "sound";
  text: string;
  start: string | null;
  end: string | null;
  start_s: number | null;
  end_s: number | null;
  character: string | null;
  parenthetical: string | null;
  scene_number: number;
  source_line: number;
  raw: string;
}

export interface Scene {
  number: number;
  heading: string;
  start: string | null;
  end: string | null;
  start_s: number | null;
  end_s: number | null;
  camera: string[];
  elements: Element[];
  source_line: number;
  inferred_bounds: boolean;
}

export interface EpisodeSummary {
  id: number;
  episode_number: number | null;
  title: string;
  logline: string;
  filename: string;
  source_archive: string | null;
  status: string;
  duration_s: number;
  scene_count: number;
  element_count: number;
  parse_warnings: string[];
  parse_errors: string[];
  last_error: string | null;
  created_at: string;
  updated_at: string;
  continuity_notes: string[];
  promo_count?: number;
  valid_promo_count?: number;
  best_score?: number | null;
  avg_score?: number | null;
}

export interface Run {
  id: number;
  job_id: number | null;
  provider: string;
  model: string;
  status: string;
  error: string | null;
  candidate_count: number;
  valid_count: number;
  created_at: string;
  episode_number?: number;
}

export interface EpisodeDetail extends EpisodeSummary {
  raw_text: string;
  parsed: { scenes: Scene[]; duration_s: number; element_count: number; dialogue_count: number };
  promos: Promo[];
  runs: Run[];
}

export interface Segment {
  start_line_id: string;
  end_line_id: string;
  start: string | null;
  end: string | null;
  start_s: number | null;
  end_s: number | null;
  duration_s: number;
  claimed_start?: string;
  claimed_end?: string;
  scenes?: number[];
  lines: { id: string; kind: string; character: string | null; text: string; start: string | null; end: string | null }[];
}

export interface Promo {
  id: number;
  rank: number;
  episode_id: number;
  episode_number: number;
  title: string;
  segments: Segment[];
  start_ts: string | null;
  end_ts: string | null;
  start_s: number | null;
  end_s: number | null;
  duration_s: number;
  hook_line: string | null;
  hook_text: string;
  hook_speaker: string | null;
  cliffhanger_line: string | null;
  cliffhanger_text: string;
  cliffhanger_speaker: string | null;
  explanation: string;
  patterns: string[];
  ai_scores: ScoreSet;
  editor_scores: Partial<ScoreSet>;
  scores: ScoreSet;
  overall: number;
  validation_status: "valid" | "invalid";
  validation_errors: { code: string; message: string }[];
  review_status: "pending" | "approved" | "rejected";
  review_notes: string | null;
  flags: string[];
  provider: string;
  model: string;
}

export interface Job {
  id: number;
  status: string;
  provider: string;
  model: string;
  progress: number;
  total: number;
  message: string;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface Activity {
  id: number;
  kind: string;
  message: string;
  created_at: string;
}

export interface Dashboard {
  totals: {
    episodes: number;
    processed: number;
    failed: number;
    candidates: number;
    valid_candidates: number;
    approved: number;
    avg_score: number | null;
  };
  top_episode: EpisodeSummary | null;
  top_promos: Promo[];
  trend: { episode: string; episode_number: number; candidates: number; valid: number; avg_score: number }[];
  activity: Activity[];
  latest_job: Job | null;
}

export interface ProviderStatus {
  id: string;
  label: string;
  configured: boolean;
  env_var: string | null;
  key_hint: string | null;
  suggested_models: string[];
  is_llm: boolean;
}

export interface Settings {
  provider: string;
  model: string;
  temperature: number;
  max_candidates_per_episode: number;
  min_duration_s: number;
  max_duration_s: number;
  allow_multi_segment: boolean;
  weak_hook_threshold: number;
  weak_cliffhanger_threshold: number;
  confusing_clarity_threshold: number;
  export_include_invalid: boolean;
  export_include_rejected: boolean;
  csv_delimiter: string;
}
