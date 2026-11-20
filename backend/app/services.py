"""Core services: ingestion, analysis jobs, ranking, raw outputs and aggregates."""
from __future__ import annotations

import csv
import io
import json
import threading
import traceback
import zipfile
from collections import Counter, defaultdict
from pathlib import PurePosixPath

from . import db
from .ai import ProviderError, get_provider
from .ai.prompt import build_prompt, episode_context
from .parser import parse_screenplay
from .validation import MAX, build_candidate, effective_scores, overall, quality_flags

ALLOWED_EXT = {".txt", ".text", ".fountain", ".md"}
MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_FILES = 500


# --------------------------------------------------------------------- ingest
def _decode(data: bytes) -> str:
    for enc in ("utf-8-sig", "utf-16", "cp1252"):
        try:
            txt = data.decode(enc)
            if enc == "utf-16" and "\x00" in txt:
                continue
            return txt
        except UnicodeDecodeError:
            continue
    return data.decode("latin-1")


def extract_files(filename: str, data: bytes) -> tuple[list[tuple[str, bytes]], list[dict]]:
    """Return ([(name, bytes)], errors). Supports .zip (nested folders) and single text files."""
    errors: list[dict] = []
    lower = filename.lower()
    if lower.endswith(".zip"):
        try:
            zf = zipfile.ZipFile(io.BytesIO(data))
        except zipfile.BadZipFile:
            return [], [{"file": filename, "error": "Not a valid ZIP archive."}]
        out = []
        for info in zf.infolist():
            p = PurePosixPath(info.filename)
            if info.is_dir() or "__MACOSX" in p.parts or p.name.startswith((".", "~$")):
                continue
            if p.suffix.lower() not in ALLOWED_EXT:
                errors.append({"file": info.filename, "error": f"Skipped: unsupported file type '{p.suffix or 'none'}'."})
                continue
            if info.file_size > MAX_FILE_BYTES:
                errors.append({"file": info.filename, "error": "Skipped: file larger than 5 MB."})
                continue
            if len(out) >= MAX_FILES:
                errors.append({"file": info.filename, "error": f"Skipped: archive exceeds {MAX_FILES} files."})
                continue
            out.append((p.name, zf.read(info)))
        if not out and not errors:
            errors.append({"file": filename, "error": "ZIP contains no screenplay text files."})
        return out, errors
    if PurePosixPath(lower).suffix in ALLOWED_EXT:
        if len(data) > MAX_FILE_BYTES:
            return [], [{"file": filename, "error": "File larger than 5 MB."}]
        return [(filename, data)], []
    return [], [{"file": filename, "error": "Unsupported file type. Upload .zip or .txt screenplay files."}]


def ingest(ws: str, uploads: list[tuple[str, bytes]]) -> dict:
    results, errors = [], []
    for fname, data in uploads:
        files, errs = extract_files(fname, data)
        errors.extend(errs)
        archive = fname if fname.lower().endswith(".zip") else None
        for name, content in files:
            text = _decode(content)
            parsed = parse_screenplay(text, name)
            status = "parsed" if not parsed.errors else "parse_error"
            replaced = None
            if parsed.episode_number is not None:
                existing = db.query_one(ws, "SELECT id FROM episodes WHERE episode_number = ?", (parsed.episode_number,))
                if existing:
                    delete_episode(ws, existing["id"], log=False)
                    replaced = existing["id"]
            pd = parsed.to_dict()
            eid = db.insert(ws, "episodes", {
                "episode_number": parsed.episode_number, "title": parsed.title, "logline": parsed.logline,
                "continuity_notes": parsed.continuity_notes, "filename": name, "source_archive": archive,
                "raw_text": text, "parsed": pd, "duration_s": parsed.duration_s, "scene_count": len(parsed.scenes),
                "element_count": pd["element_count"], "status": status, "parse_warnings": parsed.warnings,
                "parse_errors": parsed.errors, "created_at": db.now(), "updated_at": db.now(),
            })
            results.append({"id": eid, "file": name, "episode_number": parsed.episode_number, "status": status,
                            "scenes": len(parsed.scenes), "elements": pd["element_count"],
                            "warnings": parsed.warnings, "errors": parsed.errors, "replaced_episode_id": replaced})
            db.log_activity(ws, "upload",
                            f"Episode {parsed.episode_number} parsed from {name}" if status == "parsed"
                            else f"Parse error in {name}: {'; '.join(parsed.errors)}",
                            {"episode_id": eid, "status": status})
    write_outputs(ws)
    return {"episodes": results, "errors": errors}


def delete_episode(ws: str, eid: int, log: bool = True) -> None:
    ep = db.query_one(ws, "SELECT episode_number FROM episodes WHERE id = ?", (eid,))
    db.execute(ws, "DELETE FROM promos WHERE episode_id = ?", (eid,))
    db.execute(ws, "DELETE FROM analysis_runs WHERE episode_id = ?", (eid,))
    db.execute(ws, "DELETE FROM episodes WHERE id = ?", (eid,))
    if log and ep:
        db.log_activity(ws, "delete", f"Episode {ep['episode_number']} deleted")
        rerank(ws)
        write_outputs(ws)


# ------------------------------------------------------------------- analysis
_running: dict[str, threading.Thread] = {}


def start_analysis(ws: str, episode_ids: list[int] | None, provider_id: str | None, model: str | None) -> dict:
    settings = db.get_settings(ws)
    provider_id = provider_id or settings["provider"]
    provider = get_provider(provider_id)
    if not provider.configured():
        raise ProviderError(f"{provider.label} is not configured. Set {provider.status().get('env_var')} on the server.")
    if ws in _running and _running[ws].is_alive():
        raise ProviderError("An analysis job is already running in this workspace.")
    if episode_ids:
        eps = [db.query_one(ws, "SELECT id, status FROM episodes WHERE id = ?", (i,)) for i in episode_ids]
        eps = [e for e in eps if e]
    else:
        eps = db.query(ws, "SELECT id, status FROM episodes ORDER BY episode_number")
    eps = [e for e in eps if e["status"] != "parse_error"]
    if not eps:
        raise ProviderError("No parsed episodes available to analyse.")
    model = model or (settings["model"] if provider.is_llm else provider.status()["suggested_models"][0])
    job_id = db.insert(ws, "jobs", {
        "kind": "analysis", "status": "queued", "provider": provider_id, "model": model,
        "episode_ids": [e["id"] for e in eps], "progress": 0, "total": len(eps),
        "message": "Queued", "created_at": db.now(),
    })
    for e in eps:
        db.update(ws, "episodes", e["id"], {"status": "queued", "updated_at": db.now()})
    t = threading.Thread(target=_run_job, args=(ws, job_id), daemon=True)
    _running[ws] = t
    t.start()
    db.log_activity(ws, "analysis", f"Analysis started for {len(eps)} episode(s) with {provider.label} ({model})", {"job_id": job_id})
    return db.query_one(ws, "SELECT * FROM jobs WHERE id = ?", (job_id,))


def analyse_episode(ws: str, job_id: int | None, episode: dict, provider, model: str, settings: dict) -> dict:
    ctx = episode_context(episode)
    prompt = build_prompt(ctx, settings)
    run_settings = {**settings, "model": model}
    run_id = db.insert(ws, "analysis_runs", {
        "job_id": job_id, "episode_id": episode["id"], "provider": provider.id, "model": model,
        "status": "running", "prompt": prompt, "created_at": db.now(),
    })
    try:
        raw = provider.generate(prompt, ctx, run_settings)
    except ProviderError as e:
        db.update(ws, "analysis_runs", run_id, {"status": "failed", "error": str(e)})
        raise
    db.update(ws, "analysis_runs", run_id, {"raw_response": raw})
    try:
        data = _parse_json(raw)
        cands = data.get("candidates") if isinstance(data, dict) else data
        if not isinstance(cands, list):
            raise ValueError("Response JSON has no 'candidates' list.")
    except ValueError as e:
        msg = f"Model response was not valid JSON for the promo schema: {e}"
        db.update(ws, "analysis_runs", run_id, {"status": "failed", "error": msg})
        raise ProviderError(msg) from e

    known = {r["episode_number"] for r in db.query(ws, "SELECT episode_number FROM episodes")}
    # A new successful run supersedes earlier candidates for this episode.
    db.execute(ws, "DELETE FROM promos WHERE episode_id = ?", (episode["id"],))
    valid = 0
    for c in cands:
        if not isinstance(c, dict):
            continue
        p = build_candidate(c, episode, ctx, settings, known)
        valid += p["validation_status"] == "valid"
        db.insert(ws, "promos", {**p, "run_id": run_id, "provider": provider.id, "model": model,
                                 "review_status": "pending", "editor_scores": {},
                                 "created_at": db.now(), "updated_at": db.now()})
    db.update(ws, "analysis_runs", run_id, {"status": "completed", "candidate_count": len(cands), "valid_count": valid})
    _save_raw(ws, episode, run_id, provider.id, model, prompt, raw)
    return {"candidates": len(cands), "valid": valid}


def _parse_json(raw: str):
    s = raw.strip()
    if s.startswith("```"):
        s = s.split("\n", 1)[1] if "\n" in s else s
        s = s.rsplit("```", 1)[0]
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        a, b = s.find("{"), s.rfind("}")
        if a >= 0 and b > a:
            return json.loads(s[a:b + 1])
        raise


def _run_job(ws: str, job_id: int) -> None:
    job = db.query_one(ws, "SELECT * FROM jobs WHERE id = ?", (job_id,))
    settings = db.get_settings(ws)
    provider = get_provider(job["provider"])
    db.update(ws, "jobs", job_id, {"status": "running", "message": "Starting"})
    failures, total_c, total_v = [], 0, 0
    for i, eid in enumerate(job["episode_ids"]):
        ep = db.query_one(ws, "SELECT * FROM episodes WHERE id = ?", (eid,))
        if not ep:
            continue
        db.update(ws, "jobs", job_id, {"message": f"Analysing episode {ep['episode_number']} ({i + 1}/{job['total']})"})
        db.update(ws, "episodes", eid, {"status": "analyzing", "updated_at": db.now()})
        try:
            r = analyse_episode(ws, job_id, ep, provider, job["model"], settings)
            total_c += r["candidates"]
            total_v += r["valid"]
            db.update(ws, "episodes", eid, {"status": "analyzed", "last_error": None, "updated_at": db.now()})
            db.log_activity(ws, "analysis", f"Episode {ep['episode_number']}: {r['candidates']} candidates ({r['valid']} valid)",
                            {"episode_id": eid, "job_id": job_id})
        except Exception as e:  # noqa: BLE001 - record any failure, never fabricate results
            msg = str(e) if isinstance(e, ProviderError) else f"{type(e).__name__}: {e}"
            if not isinstance(e, ProviderError):
                traceback.print_exc()
            failures.append({"episode_number": ep["episode_number"], "error": msg})
            db.update(ws, "episodes", eid, {"status": "analysis_failed", "last_error": msg, "updated_at": db.now()})
            db.log_activity(ws, "error", f"Episode {ep['episode_number']} analysis failed: {msg}", {"episode_id": eid, "job_id": job_id})
        db.update(ws, "jobs", job_id, {"progress": i + 1})
    rerank(ws)
    write_outputs(ws)
    status = "completed" if not failures else ("failed" if len(failures) == job["total"] else "completed_with_errors")
    db.update(ws, "jobs", job_id, {
        "status": status, "finished_at": db.now(),
        "message": f"{total_c} candidates, {total_v} valid" + (f"; {len(failures)} episode(s) failed" if failures else ""),
        "error": json.dumps(failures) if failures else None,
    })


def rerank(ws: str) -> None:
    promos = db.query(ws, "SELECT id, ai_scores, editor_scores, validation_status FROM promos")
    for p in promos:
        p["overall"] = overall(effective_scores(p))
    promos.sort(key=lambda p: (p["validation_status"] != "valid", -p["overall"], p["id"]))
    with db.connect(ws) as con:
        for i, p in enumerate(promos, 1):
            con.execute("UPDATE promos SET rank = ?, overall = ? WHERE id = ?", (i, p["overall"], p["id"]))


def update_promo(ws: str, pid: int, body: dict) -> dict:
    p = db.query_one(ws, "SELECT * FROM promos WHERE id = ?", (pid,))
    if not p:
        raise KeyError(pid)
    data = {"updated_at": db.now()}
    if "editor_scores" in body:
        es = {}
        for k, v in (body["editor_scores"] or {}).items():
            if k in MAX and v is not None:
                es[k] = max(0.0, min(float(MAX[k]), float(v)))
        data["editor_scores"] = es
    if "review_status" in body:
        if body["review_status"] not in ("pending", "approved", "rejected"):
            raise ValueError("review_status must be pending, approved or rejected")
        data["review_status"] = body["review_status"]
    if "review_notes" in body:
        data["review_notes"] = (body["review_notes"] or "")[:2000]
    db.update(ws, "promos", pid, data)
    rerank(ws)
    write_outputs(ws)
    if "review_status" in body:
        db.log_activity(ws, "review", f"Promo #{pid} (Ep {p['episode_number']}) marked {body['review_status']}")
    elif "editor_scores" in body:
        db.log_activity(ws, "review", f"Editor adjusted scores for promo #{pid} (Ep {p['episode_number']})")
    return get_promo(ws, pid)


# --------------------------------------------------------------- read models
def decorate(ws: str, p: dict, settings: dict | None = None) -> dict:
    settings = settings or db.get_settings(ws)
    p["scores"] = effective_scores(p)
    p["flags"] = quality_flags(p, settings)
    return p


def get_promo(ws: str, pid: int) -> dict | None:
    p = db.query_one(ws, "SELECT * FROM promos WHERE id = ?", (pid,))
    return decorate(ws, p) if p else None


def list_promos(ws: str) -> list[dict]:
    s = db.get_settings(ws)
    return [decorate(ws, p, s) for p in db.query(ws, "SELECT * FROM promos ORDER BY rank ASC, id ASC")]


def episode_summary(e: dict) -> dict:
    return {k: e[k] for k in ("id", "episode_number", "title", "logline", "filename", "source_archive", "status",
                              "duration_s", "scene_count", "element_count", "parse_warnings", "parse_errors",
                              "last_error", "created_at", "updated_at", "continuity_notes")}


def list_episodes(ws: str) -> list[dict]:
    eps = db.query(ws, "SELECT * FROM episodes ORDER BY episode_number ASC, id ASC")
    counts = {r["episode_id"]: r for r in db.query(ws, """
        SELECT episode_id, COUNT(*) AS n, SUM(validation_status='valid') AS v, MAX(overall) AS best, AVG(overall) AS avg
        FROM promos GROUP BY episode_id""")}
    out = []
    for e in eps:
        s = episode_summary(e)
        c = counts.get(e["id"], {})
        s.update({"promo_count": c.get("n", 0) or 0, "valid_promo_count": c.get("v", 0) or 0,
                  "best_score": c.get("best"), "avg_score": c.get("avg")})
        out.append(s)
    return out


def dashboard(ws: str) -> dict:
    eps = list_episodes(ws)
    promos = list_promos(ws)
    valid = [p for p in promos if p["validation_status"] == "valid"]
    processed = [e for e in eps if e["status"] == "analyzed"]
    top_ep = max((e for e in eps if e["best_score"] is not None), key=lambda e: (e["avg_score"] or 0), default=None)
    trend = []
    for e in eps:
        ps = [p for p in promos if p["episode_id"] == e["id"]]
        vs = [p for p in ps if p["validation_status"] == "valid"]
        trend.append({"episode": f"Ep {e['episode_number']}", "episode_number": e["episode_number"],
                      "candidates": len(ps), "valid": len(vs),
                      "avg_score": round(sum(p["overall"] for p in vs) / len(vs), 1) if vs else 0})
    return {
        "totals": {
            "episodes": len(eps),
            "processed": len(processed),
            "failed": sum(e["status"] in ("analysis_failed", "parse_error") for e in eps),
            "candidates": len(promos),
            "valid_candidates": len(valid),
            "approved": sum(p["review_status"] == "approved" for p in promos),
            "avg_score": round(sum(p["overall"] for p in valid) / len(valid), 1) if valid else None,
        },
        "top_episode": top_ep,
        "top_promos": valid[:5],
        "trend": trend,
        "activity": db.query(ws, "SELECT * FROM activity ORDER BY id DESC LIMIT 12"),
        "latest_job": db.query_one(ws, "SELECT * FROM jobs ORDER BY id DESC LIMIT 1"),
    }


def analytics(ws: str) -> dict:
    promos = list_promos(ws)
    valid = [p for p in promos if p["validation_status"] == "valid"]
    buckets = [(0, 40), (40, 50), (50, 60), (60, 70), (70, 80), (80, 90), (90, 101)]
    dist = [{"range": f"{a}-{min(b, 100)}", "count": sum(a <= p["overall"] < b for p in valid)} for a, b in buckets]
    by_ep = defaultdict(list)
    for p in valid:
        by_ep[p["episode_number"]].append(p)
    comparison = []
    for n in sorted(by_ep):
        ps = by_ep[n]
        avg = lambda k: round(sum(p["scores"][k] for p in ps) / len(ps), 1)
        comparison.append({"episode": f"Ep {n}", "episode_number": n, "count": len(ps),
                           "best": round(max(p["overall"] for p in ps), 1),
                           "avg": round(sum(p["overall"] for p in ps) / len(ps), 1),
                           "hook": avg("hook_strength"), "cliffhanger": avg("cliffhanger_strength"),
                           "emotion": avg("emotional_impact"), "clarity": avg("standalone_clarity")})
    pats = Counter(pt for p in valid for pt in (p.get("patterns") or []))
    scatter = [{"id": p["id"], "episode": p["episode_number"], "hook": p["scores"]["hook_strength"],
                "cliffhanger": p["scores"]["cliffhanger_strength"], "overall": p["overall"], "title": p["title"]}
               for p in valid]
    dims = {k: round(sum(p["scores"][k] for p in valid) / len(valid), 1) if valid else 0 for k in MAX}
    durations = [{"id": p["id"], "duration": p["duration_s"], "overall": p["overall"]} for p in valid]
    return {"distribution": dist, "episode_comparison": comparison,
            "patterns": [{"pattern": k, "count": v} for k, v in pats.most_common(12)],
            "hook_vs_cliffhanger": scatter, "dimension_averages": dims, "durations": durations,
            "review": dict(Counter(p["review_status"] for p in promos))}


def evaluation(ws: str) -> dict:
    promos = list_promos(ws)
    flags = Counter(f for p in promos for f in p["flags"])
    codes = Counter(e["code"] for p in promos for e in (p.get("validation_errors") or []))
    runs = db.query(ws, """SELECT r.id, r.job_id, r.episode_id, e.episode_number, r.provider, r.model, r.status, r.error,
                           r.candidate_count, r.valid_count, r.created_at FROM analysis_runs r
                           LEFT JOIN episodes e ON e.id = r.episode_id ORDER BY r.id DESC LIMIT 100""")
    eps = list_episodes(ws)
    return {
        "summary": {
            "total_candidates": len(promos),
            "valid": sum(p["validation_status"] == "valid" for p in promos),
            "invalid": sum(p["validation_status"] != "valid" for p in promos),
            "invalid_timestamp": flags.get("invalid_timestamp", 0),
            "duration_out_of_range": flags.get("duration_out_of_range", 0),
            "unverified_excerpt": flags.get("unverified_excerpt", 0),
            "weak_hook": flags.get("weak_hook", 0),
            "weak_cliffhanger": flags.get("weak_cliffhanger", 0),
            "potentially_confusing": flags.get("potentially_confusing", 0),
            "review": {s: sum(p["review_status"] == s for p in promos) for s in ("pending", "approved", "rejected")},
            "failed_runs": sum(r["status"] == "failed" for r in runs),
            "parse_warnings": sum(len(e["parse_warnings"] or []) for e in eps),
            "parse_errors": sum(len(e["parse_errors"] or []) for e in eps),
        },
        "error_codes": dict(codes),
        "candidates": [{k: p[k] for k in ("id", "rank", "episode_number", "title", "start_ts", "end_ts", "duration_s",
                                          "overall", "scores", "flags", "validation_status", "validation_errors",
                                          "review_status", "provider", "model")} for p in promos],
        "runs": runs,
        "parse_issues": [{"episode_number": e["episode_number"], "filename": e["filename"], "status": e["status"],
                          "warnings": e["parse_warnings"], "errors": e["parse_errors"]} for e in eps
                         if e["parse_warnings"] or e["parse_errors"]],
    }


# ------------------------------------------------------------------- outputs
CSV_FIELDS = ["rank", "id", "episode_number", "title", "start_ts", "end_ts", "duration_s", "segment_count", "segments",
              "hook_line", "hook_speaker", "hook_text", "cliffhanger_line", "cliffhanger_speaker", "cliffhanger_text",
              "overall", "hook_strength", "cliffhanger_strength", "emotional_impact", "standalone_clarity",
              "ai_overall", "editor_adjusted", "patterns", "explanation", "validation_status", "validation_errors",
              "flags", "review_status", "review_notes", "provider", "model"]


def promo_rows(promos: list[dict]) -> list[dict]:
    rows = []
    for p in promos:
        s = p["scores"]
        rows.append({
            "rank": p["rank"], "id": p["id"], "episode_number": p["episode_number"], "title": p["title"],
            "start_ts": p["start_ts"], "end_ts": p["end_ts"], "duration_s": p["duration_s"],
            "segment_count": len(p["segments"] or []),
            "segments": " | ".join(f"{x.get('start')}-{x.get('end')} ({x.get('start_line_id')}-{x.get('end_line_id')})" for x in p["segments"] or []),
            "hook_line": p["hook_line"], "hook_speaker": p["hook_speaker"], "hook_text": p["hook_text"],
            "cliffhanger_line": p["cliffhanger_line"], "cliffhanger_speaker": p["cliffhanger_speaker"],
            "cliffhanger_text": p["cliffhanger_text"], "overall": p["overall"],
            **{k: s[k] for k in MAX}, "ai_overall": overall(p["ai_scores"] or {}),
            "editor_adjusted": bool(p.get("editor_scores")), "patterns": "; ".join(p.get("patterns") or []),
            "explanation": p["explanation"], "validation_status": p["validation_status"],
            "validation_errors": "; ".join(e["message"] for e in p.get("validation_errors") or []),
            "flags": "; ".join(p["flags"]), "review_status": p["review_status"], "review_notes": p.get("review_notes") or "",
            "provider": p["provider"], "model": p["model"],
        })
    return rows


def to_csv(rows: list[dict], fields: list[str], delimiter: str = ",") -> str:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=fields, delimiter=delimiter, extrasaction="ignore")
    w.writeheader()
    w.writerows(rows)
    return buf.getvalue()


def export_promos(ws: str, ids: list[int] | None = None) -> list[dict]:
    s = db.get_settings(ws)
    ps = list_promos(ws)
    if ids:
        ps = [p for p in ps if p["id"] in ids]
    else:
        if not s.get("export_include_invalid", True):
            ps = [p for p in ps if p["validation_status"] == "valid"]
        if not s.get("export_include_rejected", True):
            ps = [p for p in ps if p["review_status"] != "rejected"]
    return ps


def _save_raw(ws, episode, run_id, provider, model, prompt, raw):
    d = db.output_dir(ws) / "ai_analysis"
    d.mkdir(exist_ok=True)
    (d / f"episode_{episode['episode_number']:03d}_run_{run_id}.json").write_text(json.dumps({
        "episode_number": episode["episode_number"], "run_id": run_id, "provider": provider, "model": model,
        "created_at": db.now(), "prompt": prompt, "raw_response": raw}, ensure_ascii=False, indent=2))


def write_outputs(ws: str) -> None:
    out = db.output_dir(ws)
    eps = db.query(ws, "SELECT * FROM episodes ORDER BY episode_number")
    (out / "parsed_episodes.json").write_text(json.dumps([
        {**episode_summary(e), "parsed": e["parsed"]} for e in eps], ensure_ascii=False, indent=2))
    promos = list_promos(ws)
    (out / "candidates.json").write_text(json.dumps(promos, ensure_ascii=False, indent=2))
    (out / "candidates.csv").write_text(to_csv(promo_rows(promos), CSV_FIELDS))
    ranking = [{"rank": p["rank"], "id": p["id"], "episode_number": p["episode_number"], "title": p["title"],
                "overall": p["overall"], **p["scores"], "validation_status": p["validation_status"],
                "review_status": p["review_status"]} for p in promos]
    (out / "ranking.json").write_text(json.dumps(ranking, ensure_ascii=False, indent=2))
    (out / "ranking.csv").write_text(to_csv(ranking, list(ranking[0].keys()) if ranking else ["rank"]))
    verr = [{"promo_id": p["id"], "episode_number": p["episode_number"], "title": p["title"], **e}
            for p in promos for e in (p.get("validation_errors") or [])]
    runs_failed = db.query(ws, "SELECT id, episode_id, provider, model, error, created_at FROM analysis_runs WHERE status='failed'")
    (out / "validation_errors.json").write_text(json.dumps({"candidate_errors": verr, "failed_runs": runs_failed},
                                                           ensure_ascii=False, indent=2))
    (out / "validation_errors.csv").write_text(to_csv(verr, ["promo_id", "episode_number", "title", "code", "message"]))
    (out / "evaluation_summary.json").write_text(json.dumps(evaluation(ws)["summary"], ensure_ascii=False, indent=2))


def outputs_zip(ws: str) -> bytes:
    write_outputs(ws)
    out = db.output_dir(ws)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(out.rglob("*")):
            if f.is_file():
                z.write(f, f.relative_to(out).as_posix())
    return buf.getvalue()
