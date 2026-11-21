"""SQLite persistence. Each workspace ("live" or "demo") has its own database
file and output directory, so demo data can never mix with real analysis."""
from __future__ import annotations

import json
import os
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.getenv("REELMIND_DATA_DIR", BASE_DIR / "data"))
OUTPUT_DIR = Path(os.getenv("REELMIND_OUTPUT_DIR", BASE_DIR / "outputs"))
WORKSPACES = ("live", "demo")

_lock = threading.RLock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS episodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_number INTEGER,
  title TEXT,
  logline TEXT,
  continuity_notes TEXT,
  filename TEXT,
  source_archive TEXT,
  raw_text TEXT,
  parsed TEXT,
  duration_s REAL,
  scene_count INTEGER,
  element_count INTEGER,
  status TEXT,
  parse_warnings TEXT,
  parse_errors TEXT,
  last_error TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT,
  status TEXT,
  provider TEXT,
  model TEXT,
  episode_ids TEXT,
  progress INTEGER DEFAULT 0,
  total INTEGER DEFAULT 0,
  message TEXT,
  error TEXT,
  created_at TEXT,
  finished_at TEXT
);
CREATE TABLE IF NOT EXISTS analysis_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER,
  episode_id INTEGER,
  provider TEXT,
  model TEXT,
  status TEXT,
  prompt TEXT,
  raw_response TEXT,
  error TEXT,
  candidate_count INTEGER DEFAULT 0,
  valid_count INTEGER DEFAULT 0,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS promos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER,
  episode_id INTEGER,
  episode_number INTEGER,
  title TEXT,
  segments TEXT,
  start_ts TEXT,
  end_ts TEXT,
  start_s REAL,
  end_s REAL,
  duration_s REAL,
  hook_line TEXT,
  hook_text TEXT,
  hook_speaker TEXT,
  cliffhanger_line TEXT,
  cliffhanger_text TEXT,
  cliffhanger_speaker TEXT,
  explanation TEXT,
  patterns TEXT,
  ai_scores TEXT,
  editor_scores TEXT,
  overall REAL,
  rank INTEGER,
  validation_status TEXT,
  validation_errors TEXT,
  review_status TEXT DEFAULT 'pending',
  review_notes TEXT,
  provider TEXT,
  model TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT,
  message TEXT,
  meta TEXT,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
"""

JSON_FIELDS = {
    "continuity_notes", "parsed", "parse_warnings", "parse_errors", "episode_ids",
    "segments", "patterns", "ai_scores", "editor_scores", "validation_errors", "meta",
}


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def db_path(ws: str) -> Path:
    if ws not in WORKSPACES:
        raise ValueError(f"Unknown workspace {ws}")
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    return DATA_DIR / f"{ws}.db"


def output_dir(ws: str) -> Path:
    p = OUTPUT_DIR / ws
    p.mkdir(parents=True, exist_ok=True)
    return p


def init_db(ws: str) -> None:
    with connect(ws) as con:
        con.executescript(SCHEMA)


@contextmanager
def connect(ws: str):
    with _lock:
        con = sqlite3.connect(db_path(ws), check_same_thread=False)
        con.row_factory = sqlite3.Row
        try:
            yield con
            con.commit()
        finally:
            con.close()


def row_to_dict(row: sqlite3.Row | None) -> dict | None:
    if row is None:
        return None
    d = dict(row)
    for k in JSON_FIELDS & d.keys():
        if d[k] is not None:
            try:
                d[k] = json.loads(d[k])
            except (TypeError, json.JSONDecodeError):
                pass
    return d


def dumps(v) -> str:
    return json.dumps(v, ensure_ascii=False)


def query(ws: str, sql: str, params=()) -> list[dict]:
    with connect(ws) as con:
        return [row_to_dict(r) for r in con.execute(sql, params).fetchall()]


def query_one(ws: str, sql: str, params=()) -> dict | None:
    with connect(ws) as con:
        return row_to_dict(con.execute(sql, params).fetchone())


def execute(ws: str, sql: str, params=()) -> int:
    with connect(ws) as con:
        cur = con.execute(sql, params)
        return cur.lastrowid


def insert(ws: str, table: str, data: dict) -> int:
    data = {k: (dumps(v) if k in JSON_FIELDS and v is not None and not isinstance(v, str) else v) for k, v in data.items()}
    cols = ", ".join(data.keys())
    qs = ", ".join("?" for _ in data)
    return execute(ws, f"INSERT INTO {table} ({cols}) VALUES ({qs})", tuple(data.values()))


def update(ws: str, table: str, row_id: int, data: dict) -> None:
    if not data:
        return
    data = {k: (dumps(v) if k in JSON_FIELDS and v is not None and not isinstance(v, str) else v) for k, v in data.items()}
    sets = ", ".join(f"{k} = ?" for k in data)
    execute(ws, f"UPDATE {table} SET {sets} WHERE id = ?", (*data.values(), row_id))


def log_activity(ws: str, kind: str, message: str, meta: dict | None = None) -> None:
    insert(ws, "activity", {"kind": kind, "message": message, "meta": meta or {}, "created_at": now()})


DEFAULT_SETTINGS = {
    # Overridable per deployment (e.g. on a host whose disk resets on restart).
    "provider": os.getenv("REELMIND_DEFAULT_PROVIDER", "gemini"),
    "model": os.getenv("REELMIND_DEFAULT_MODEL", "gemini-2.5-flash"),
    "temperature": 0.4,
    "max_candidates_per_episode": 5,
    "min_duration_s": 20,
    "max_duration_s": 60,
    "allow_multi_segment": True,
    "weak_hook_threshold": 15,
    "weak_cliffhanger_threshold": 15,
    "confusing_clarity_threshold": 10,
    "export_include_invalid": True,
    "export_include_rejected": True,
    "csv_delimiter": ",",
}


def get_settings(ws: str) -> dict:
    s = dict(DEFAULT_SETTINGS)
    for r in query(ws, "SELECT key, value FROM settings"):
        try:
            s[r["key"]] = json.loads(r["value"])
        except json.JSONDecodeError:
            s[r["key"]] = r["value"]
    return s


def save_settings(ws: str, values: dict) -> dict:
    with connect(ws) as con:
        for k, v in values.items():
            if k in DEFAULT_SETTINGS:
                con.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (k, json.dumps(v)))
    return get_settings(ws)
