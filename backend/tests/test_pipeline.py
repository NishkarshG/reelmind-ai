from pathlib import Path

from app.ai.prompt import episode_context
from app.parser import parse_screenplay
from app.validation import build_candidate

SAMPLES = Path(__file__).resolve().parent.parent / "sample_scripts"
SETTINGS = {"min_duration_s": 20, "max_duration_s": 60}


def _episode(name="EP01_The_Engagement.txt"):
    p = parse_screenplay((SAMPLES / name).read_text(), name)
    return {"id": 1, "episode_number": p.episode_number, "logline": p.logline,
            "continuity_notes": p.continuity_notes, "parsed": p.to_dict()}


def test_parses_all_sample_formats():
    for f in SAMPLES.glob("*.txt"):
        p = parse_screenplay(f.read_text(), f.name)
        assert p.episode_number is not None, f
        assert p.logline, f
        assert len(p.scenes) == 3, f
        assert all(e.start and e.end for e in p.all_elements()), f
        assert not p.errors, f


def test_preserves_dialogue_exactly():
    p = parse_screenplay((SAMPLES / "EP04_Rooftop_Confession.txt").read_text())
    el = next(e for e in p.all_elements() if e.id == "L003")
    assert el.character == "MAYA" and el.parenthetical == "without turning"
    assert el.text == "My mother wrote that she was afraid of Nandini. Why would she write that, Vikram?"
    p5 = parse_screenplay((SAMPLES / "EP05_The_Will.txt").read_text())
    assert p5.scenes[0].start == "00:00" and p5.all_elements()[1].character == "ARJUN"


def test_valid_candidate():
    ep = _episode()
    ctx = episode_context(ep)
    raw = {"segments": [{"start_line_id": "L019", "end_line_id": "L022", "start": "00:01:26", "end": "00:01:46"}],
           "hook": {"line_id": "L019", "quote": "He reaches for her. She slaps him."},
           "cliffhanger": {"line_id": "L022", "quote": "Thunder rolls outside."},
           "scores": {"hook_strength": 25, "cliffhanger_strength": 20, "emotional_impact": 15, "standalone_clarity": 15}}
    c = build_candidate(raw, ep, ctx, SETTINGS, {1})
    assert c["validation_status"] == "valid", c["validation_errors"]
    assert c["duration_s"] == 20 and c["overall"] == 75


def test_invalid_candidate_is_flagged_not_dropped():
    ep = _episode()
    ctx = episode_context(ep)
    raw = {"episode_number": 9,
           "segments": [{"start_line_id": "L010", "end_line_id": "L012", "start": "00:00:40", "end": "00:01:02"},
                        {"start_line_id": "L005", "end_line_id": "L999"}],
           "hook": {"line_id": "L010", "quote": "I will destroy you all"},
           "cliffhanger": {"line_id": "L012"},
           "scores": {"hook_strength": 45, "cliffhanger_strength": 10, "emotional_impact": 10, "standalone_clarity": 10}}
    c = build_candidate(raw, ep, ctx, SETTINGS, {1})
    codes = {e["code"] for e in c["validation_errors"]}
    assert c["validation_status"] == "invalid"
    assert {"episode_missing", "invalid_timestamp", "excerpt_not_found", "score_out_of_range"} <= codes


def test_llm_path_with_stub_provider(tmp_path, monkeypatch):
    """Simulates an LLM response (one faithful candidate, one hallucinated) through the full pipeline."""
    import json
    monkeypatch.setenv("REELMIND_DATA_DIR", str(tmp_path))
    import importlib
    from app import db, services
    importlib.reload(db)
    importlib.reload(services)
    from app.ai.base import AIProvider

    class Stub(AIProvider):
        id, label, is_llm = "stub", "Stub LLM", True
        def configured(self): return True
        def status(self): return {}
        def generate(self, prompt, context, settings):
            assert "L019" in prompt and "STRICT RULES" in prompt
            return "```json\n" + json.dumps({"candidates": [
                {"title": "The slap", "segments": [{"start_line_id": "L019", "end_line_id": "L022", "start": "00:01:26", "end": "00:01:46"}],
                 "hook": {"line_id": "L019", "quote": "He reaches for her. She slaps him."},
                 "cliffhanger": {"line_id": "L022", "quote": "Thunder rolls outside."},
                 "explanation": "x", "patterns": ["Confrontation"],
                 "scores": {"hook_strength": 26, "cliffhanger_strength": 22, "emotional_impact": 17, "standalone_clarity": 15}},
                {"title": "Invented", "segments": [{"start_line_id": "L001", "end_line_id": "L003", "start": "00:00:00", "end": "00:00:30"}],
                 "hook": {"line_id": "L001", "quote": "Maya pulls out a gun."},
                 "cliffhanger": {"line_id": "L003"},
                 "scores": {"hook_strength": 20, "cliffhanger_strength": 20, "emotional_impact": 10, "standalone_clarity": 10}},
            ]}) + "\n```"

    db.init_db("live")
    services.ingest("live", [("EP01.txt", (SAMPLES / "EP01_The_Engagement.txt").read_bytes())])
    ep = db.query("live", "SELECT * FROM episodes")[0]
    r = services.analyse_episode("live", None, ep, Stub(), "stub-1", db.get_settings("live"))
    assert r == {"candidates": 2, "valid": 1}
    ps = {p["title"]: p for p in services.list_promos("live")}
    assert ps["The slap"]["validation_status"] == "valid"
    bad = ps["Invented"]
    assert bad["validation_status"] == "invalid"
    codes = {e["code"] for e in bad["validation_errors"]}
    assert "excerpt_not_found" in codes and "invalid_timestamp" in codes and "duration_out_of_range" in codes
