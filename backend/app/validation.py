"""Deterministic validation of AI-proposed promo candidates.

The model only proposes line-ID ranges; timestamps and text shown to users are
always copied from the parsed screenplay. Any disagreement between what the
model claims and what the script says is recorded as a validation error.
Candidates that fail are kept (status "invalid"), never silently dropped."""
from __future__ import annotations

import re
import unicodedata

from .parser import seconds_to_ts, ts_to_seconds

MAX = {"hook_strength": 30, "cliffhanger_strength": 30, "emotional_impact": 20, "standalone_clarity": 20}


def _norm(t: str) -> str:
    t = unicodedata.normalize("NFKC", t or "").lower()
    t = t.replace("“", '"').replace("”", '"').replace("’", "'").replace("‘", "'")
    t = re.sub(r"[\"'`]", "", t)
    return re.sub(r"\s+", " ", t).strip()


def _quote_in(quote: str, text: str) -> bool:
    q, t = _norm(quote), _norm(text)
    if not q:
        return True
    q = q.strip(". …")
    return q in t


def overall(scores: dict) -> float:
    return float(sum(max(0, min(MAX[k], float(scores.get(k, 0) or 0))) for k in MAX))


def build_candidate(raw: dict, episode: dict, ctx: dict, settings: dict, known_episodes: set[int]) -> dict:
    errors: list[dict] = []

    def err(code: str, msg: str):
        errors.append({"code": code, "message": msg})

    by_id = {e["id"]: e for e in ctx["elements"]}
    order = {e["id"]: i for i, e in enumerate(ctx["elements"])}
    ep_num = raw.get("episode_number", episode["episode_number"])
    try:
        ep_num = int(ep_num)
    except (TypeError, ValueError):
        err("episode_missing", f"Episode reference '{ep_num}' is not a number.")
        ep_num = episode["episode_number"]
    if ep_num not in known_episodes:
        err("episode_missing", f"Referenced episode {ep_num} does not exist.")
    elif ep_num != episode["episode_number"]:
        err("episode_mismatch", f"Candidate references episode {ep_num} but was produced for episode {episode['episode_number']}.")

    segments = []
    raw_segs = raw.get("segments") or []
    if not isinstance(raw_segs, list) or not raw_segs:
        err("no_segments", "Candidate has no segments.")
        raw_segs = []
    for i, s in enumerate(raw_segs, 1):
        sid, eid = s.get("start_line_id"), s.get("end_line_id")
        if sid not in by_id or eid not in by_id:
            missing = [x for x in (sid, eid) if x not in by_id]
            err("excerpt_not_found", f"Segment {i}: line id(s) {missing} do not exist in the screenplay.")
            segments.append({"start_line_id": sid, "end_line_id": eid, "start": s.get("start"), "end": s.get("end"),
                             "start_s": None, "end_s": None, "duration_s": 0, "lines": [], "claimed_start": s.get("start"),
                             "claimed_end": s.get("end")})
            continue
        a, b = by_id[sid], by_id[eid]
        if order[eid] < order[sid]:
            err("reversed_segment", f"Segment {i}: end line {eid} precedes start line {sid}.")
        lines = [e for e in ctx["elements"] if order[sid] <= order[e["id"]] <= order[eid]]
        st, en = a.get("start_s"), b.get("end_s")
        if st is None or en is None:
            err("invalid_timestamp", f"Segment {i}: referenced lines have no timestamps in the screenplay.")
        elif st >= en:
            err("invalid_timestamp", f"Segment {i}: start {a['start']} is not before end {b['end']}.")
        for claim, real, label in ((s.get("start"), a.get("start"), "start"), (s.get("end"), b.get("end"), "end")):
            if claim and real:
                try:
                    if abs(ts_to_seconds(str(claim)) - ts_to_seconds(real)) > 0.5:
                        err("invalid_timestamp", f"Segment {i}: claimed {label} {claim} does not match screenplay timestamp {real} for {sid if label == 'start' else eid}.")
                except (ValueError, IndexError):
                    err("invalid_timestamp", f"Segment {i}: claimed {label} '{claim}' is not a valid timestamp.")
        segments.append({
            "start_line_id": sid, "end_line_id": eid, "start": a.get("start"), "end": b.get("end"),
            "start_s": st, "end_s": en, "duration_s": round((en - st), 3) if st is not None and en is not None else 0,
            "claimed_start": s.get("start"), "claimed_end": s.get("end"),
            "scenes": sorted({l["scene"] for l in lines}),
            "lines": [{"id": l["id"], "kind": l["kind"], "character": l.get("character"), "text": l["text"],
                       "start": l.get("start"), "end": l.get("end")} for l in lines],
        })

    good = [s for s in segments if s["start_s"] is not None and s["end_s"] is not None]
    for p, q in zip(good, good[1:]):
        if q["start_s"] < p["end_s"]:
            err("not_chronological", f"Segment starting {q['start']} begins before previous segment ends ({p['end']}).")
    duration = round(sum(s["duration_s"] for s in good), 3)
    mn, mx = float(settings.get("min_duration_s", 20)), float(settings.get("max_duration_s", 60))
    if good and not (mn <= duration <= mx):
        err("duration_out_of_range", f"Total duration {duration:.1f}s is outside {mn:.0f}-{mx:.0f}s.")

    def resolve(key: str, seg_idx: int):
        obj = raw.get(key) or {}
        if isinstance(obj, str):
            obj = {"quote": obj}
        lid, quote = obj.get("line_id"), obj.get("quote") or ""
        el = by_id.get(lid)
        if el is None:
            # try locating by quote within the candidate's lines
            for s in segments:
                for l in s.get("lines", []):
                    if quote and _quote_in(quote, l["text"]):
                        el = by_id[l["id"]]
                        break
                if el:
                    break
            if el is None:
                err("excerpt_not_found", f"{key.title()} line '{lid}' not found in screenplay.")
                return None, quote, None
        if quote and not _quote_in(quote, el["text"]):
            err("excerpt_not_found", f"{key.title()} quote does not match the original text of {el['id']} (possible invented dialogue).")
        in_seg = False
        if segments:
            s = segments[seg_idx]
            in_seg = any(l["id"] == el["id"] for l in s.get("lines", []))
        if not in_seg:
            err(f"{key}_outside_segment", f"{key.title()} line {el['id']} is not inside the {'first' if seg_idx == 0 else 'last'} segment.")
        return el, el["text"], el.get("character")

    hook_el, hook_text, hook_speaker = resolve("hook", 0)
    cl_el, cl_text, cl_speaker = resolve("cliffhanger", -1)

    raw_scores = raw.get("scores") or {}
    scores = {}
    for k, m in MAX.items():
        v = raw_scores.get(k)
        try:
            v = float(v)
        except (TypeError, ValueError):
            err("score_missing", f"Score '{k}' missing or not numeric.")
            v = 0.0
        if v < 0 or v > m:
            err("score_out_of_range", f"Score '{k}'={v} outside 0-{m}; clamped.")
            v = max(0.0, min(float(m), v))
        scores[k] = round(v, 1)

    start_s = good[0]["start_s"] if good else None
    end_s = good[-1]["end_s"] if good else None
    return {
        "episode_id": episode["id"],
        "episode_number": episode["episode_number"],
        "title": (raw.get("title") or "Untitled promo")[:140],
        "segments": segments,
        "start_ts": seconds_to_ts(start_s) if start_s is not None else None,
        "end_ts": seconds_to_ts(end_s) if end_s is not None else None,
        "start_s": start_s,
        "end_s": end_s,
        "duration_s": duration,
        "hook_line": hook_el["id"] if hook_el else None,
        "hook_text": hook_text,
        "hook_speaker": hook_speaker,
        "cliffhanger_line": cl_el["id"] if cl_el else None,
        "cliffhanger_text": cl_text,
        "cliffhanger_speaker": cl_speaker,
        "explanation": raw.get("explanation") or "",
        "patterns": [str(p) for p in (raw.get("patterns") or [])][:6],
        "ai_scores": scores,
        "overall": overall(scores),
        "validation_status": "valid" if not errors else "invalid",
        "validation_errors": errors,
    }


def quality_flags(p: dict, settings: dict) -> list[str]:
    s = effective_scores(p)
    flags = []
    codes = {e["code"] for e in (p.get("validation_errors") or [])}
    if "invalid_timestamp" in codes or "reversed_segment" in codes or "not_chronological" in codes:
        flags.append("invalid_timestamp")
    if "duration_out_of_range" in codes:
        flags.append("duration_out_of_range")
    if "excerpt_not_found" in codes or "episode_missing" in codes:
        flags.append("unverified_excerpt")
    if s["hook_strength"] < float(settings.get("weak_hook_threshold", 15)):
        flags.append("weak_hook")
    if s["cliffhanger_strength"] < float(settings.get("weak_cliffhanger_threshold", 15)):
        flags.append("weak_cliffhanger")
    if s["standalone_clarity"] < float(settings.get("confusing_clarity_threshold", 10)):
        flags.append("potentially_confusing")
    return flags


def effective_scores(p: dict) -> dict:
    s = dict(p.get("ai_scores") or {})
    for k, v in (p.get("editor_scores") or {}).items():
        if k in MAX and v is not None:
            s[k] = float(v)
    for k in MAX:
        s.setdefault(k, 0.0)
    return s
