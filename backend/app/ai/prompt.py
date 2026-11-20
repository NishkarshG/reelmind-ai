"""Prompt construction for LLM promo discovery."""
from __future__ import annotations


def episode_context(episode: dict) -> dict:
    parsed = episode["parsed"]
    elements = []
    for sc in parsed["scenes"]:
        for e in sc["elements"]:
            elements.append({
                "id": e["id"], "scene": sc["number"], "kind": e["kind"], "character": e.get("character"),
                "parenthetical": e.get("parenthetical"), "text": e["text"], "start": e.get("start"),
                "end": e.get("end"), "start_s": e.get("start_s"), "end_s": e.get("end_s"),
            })
    return {
        "episode_number": episode["episode_number"],
        "logline": episode.get("logline") or "",
        "continuity_notes": episode.get("continuity_notes") or [],
        "scenes": [{"number": s["number"], "heading": s["heading"], "start": s.get("start"), "end": s.get("end"),
                    "camera": s.get("camera", [])} for s in parsed["scenes"]],
        "elements": elements,
    }


def build_prompt(ctx: dict, settings: dict) -> str:
    mn, mx = settings.get("min_duration_s", 20), settings.get("max_duration_s", 60)
    n = settings.get("max_candidates_per_episode", 5)
    multi = settings.get("allow_multi_segment", True)
    lines = []
    for s in ctx["scenes"]:
        lines.append(f"\n## SCENE {s['number']}: {s['heading']} [{s['start']} - {s['end']}]")
        for c in s["camera"]:
            lines.append(f"   (camera) {c}")
        for e in ctx["elements"]:
            if e["scene"] != s["number"]:
                continue
            who = (f"{e['character']}" + (f" ({e['parenthetical']})" if e.get("parenthetical") else "")) if e["kind"] == "dialogue" \
                else {"action": "ACTION", "camera": "CAMERA", "sound": "SOUND FX"}.get(e["kind"], e["kind"].upper())
            lines.append(f"[{e['id']}] {e['start']} - {e['end']} | {who}: {e['text']}")
    script = "\n".join(lines)
    notes = "\n".join(f"- {x}" for x in ctx["continuity_notes"]) or "- (none)"
    return f"""You are a senior promo editor for vertical microdramas. Find the best {mn}-{mx} second promotional clips in ONE episode.

A great promo has:
1. A strong opening hook within the first seconds (a line or action that grabs attention immediately).
2. Emotional or dramatic intensity (confrontation, reveal, betrayal, humiliation, romance).
3. Standalone clarity: a viewer who has never seen the show understands the stakes.
4. A strong cliffhanger ending that makes the viewer want to watch the episode.

STRICT RULES
- Use ONLY the line IDs below. Never invent, paraphrase or merge dialogue. Quotes must be copied verbatim from the referenced line.
- A segment is a continuous range of lines from start_line_id to end_line_id (inclusive). Its start/end timestamps must equal the start of the first line and the end of the last line, copied exactly.
- Total duration (sum of segments) must be between {mn} and {mx} seconds.
- Prefer ONE continuous segment. {"Use 2-3 segments only if they clearly improve the story; segments must be in chronological order and must not overlap." if multi else "Use exactly one continuous segment per candidate."}
- hook.line_id must be inside the first segment; cliffhanger.line_id must be inside the last segment. Hooks and cliffhangers should be DIALOGUE, ACTION or SOUND FX lines (not CAMERA).
- CAMERA lines are shot boundaries; starting or ending a segment on a CAMERA line gives the editor a clean cut point. Timed lines may overlap: a segment's timestamps are the earliest start and latest end among its lines.
- Return up to {n} candidates, best first. Diversity is better than near-duplicates.
- Scores are editorial promo-potential judgments, NOT predictions of views or virality.

SCORING (integers): hook_strength 0-30, cliffhanger_strength 0-30, emotional_impact 0-20, standalone_clarity 0-20.

Return ONLY JSON with this exact shape:
{{"candidates": [{{
  "title": "short working title",
  "segments": [{{"start_line_id": "L001", "end_line_id": "L009", "start": "00:00:00", "end": "00:00:42"}}],
  "hook": {{"line_id": "L002", "quote": "verbatim text of that line"}},
  "cliffhanger": {{"line_id": "L009", "quote": "verbatim text of that line"}},
  "explanation": "2-3 sentences on why this works as a promo and what a new viewer understands",
  "patterns": ["e.g. Hidden identity reveal", "Public humiliation"],
  "scores": {{"hook_strength": 0, "cliffhanger_strength": 0, "emotional_impact": 0, "standalone_clarity": 0}}
}}]}}

EPISODE {ctx['episode_number']}
LOGLINE: {ctx['logline']}
CONTINUITY NOTES:
{notes}

SCREENPLAY (line ID, timestamps, speaker or block type, text):
{script}
"""
