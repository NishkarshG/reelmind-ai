"""Rule-based baseline provider (offline, no LLM).

Clearly labelled as a deterministic baseline in the UI. It is never used as a
silent fallback when an LLM call fails; users must select it explicitly. It is
also what powers the clearly-labelled demo workspace. Its output follows the
exact same JSON contract as the LLM, so it is validated identically."""
from __future__ import annotations

import json
import re

from .base import AIProvider

REVEAL = {
    "dead": 3, "died": 3, "alive": 4, "truth": 3, "secret": 4, "lie": 3, "lied": 3, "forged": 4, "forge": 4,
    "blood": 3, "daughter": 3, "sister": 4, "murder": 4, "murdered": 4, "fire": 2, "body": 3, "will": 1,
    "everything": 2, "impossible": 3, "never": 1, "knew": 2, "know": 1, "locked": 3, "chained": 4,
    "contract": 3, "favour": 2, "results": 2, "granddaughter": 3, "heir": 3, "prove": 2, "tape": 3,
    "afraid": 2, "destroy": 3, "hate": 2, "nothing": 1, "who": 2,
}
INTENSE_ACTION = {
    "slap": 4, "slaps": 4, "crash": 3, "crashes": 3, "shatter": 3, "shatters": 3, "freezes": 3, "freeze": 3,
    "pale": 2, "gasps": 3, "tears": 3, "handcuffs": 4, "police": 3, "guards": 2, "grip": 2, "grinds": 3,
    "snaps": 2, "thunder": 2, "scarred": 3, "trembling": 2, "afraid": 2, "shaking": 2, "smile": 1,
    "stares": 2, "listening": 3, "creaks": 2, "watches": 2, "alive": 4,
}


def _words(t: str) -> list[str]:
    return re.findall(r"[a-z']+", t.lower())


def line_intensity(el: dict) -> float:
    t = el.get("text") or ""
    w = _words(t)
    s = sum(REVEAL.get(x, 0) for x in w) + sum(INTENSE_ACTION.get(x, 0) for x in w)
    if "?" in t:
        s += 2
    if "!" in t:
        s += 1
    if "—" in t or t.rstrip().endswith("-"):
        s += 1.5
    if el.get("kind") == "dialogue":
        s += 1
    return min(s, 12.0)


class HeuristicProvider(AIProvider):
    id = "heuristic"
    label = "Rule-based baseline (offline, no LLM)"
    is_llm = False

    def configured(self) -> bool:
        return True

    def status(self) -> dict:
        return {"id": self.id, "label": self.label, "configured": True, "env_var": None,
                "key_hint": None, "suggested_models": ["keyword-baseline-v1"], "is_llm": False}

    def generate(self, prompt: str, context: dict, settings: dict) -> str:
        els = [e for e in context["elements"] if e.get("start_s") is not None and e.get("end_s") is not None
               and e["end_s"] > e["start_s"]]
        mn, mx = float(settings.get("min_duration_s", 20)), float(settings.get("max_duration_s", 60))
        n_max = int(settings.get("max_candidates_per_episode", 5))
        scene_first = {}
        scene_last = {}
        for e in els:
            scene_first.setdefault(e["scene"], e["id"])
            scene_last[e["scene"]] = e["id"]
        last_id = els[-1]["id"] if els else None
        inten = {e["id"]: line_intensity(e) for e in els}

        windows = []
        for i in range(len(els)):
            for j in range(i, len(els)):
                dur = els[j]["end_s"] - els[i]["start_s"]
                if dur > mx:
                    break
                if dur < mn:
                    continue
                win = els[i:j + 1]
                first, last = win[0], win[-1]
                hook_el = max(win[:2], key=lambda e: inten[e["id"]])
                hook = min(30, 8 + inten[hook_el["id"]] * 2 + (3 if hook_el["kind"] == "dialogue" else 0))
                cl = inten[last["id"]] * 1.8 + 6
                if last["id"] == scene_last.get(last["scene"]):
                    cl += 4
                if last["id"] == last_id:
                    cl += 4
                if "?" in (last.get("text") or "") or "—" in (last.get("text") or ""):
                    cl += 3
                cliff = min(30, cl)
                emo = min(20, 4 + sum(inten[e["id"]] for e in win) / len(win) * 2.2)
                scenes = {e["scene"] for e in win}
                chars = {e.get("character") for e in win if e.get("character")}
                clar = 16.0
                if first["id"] == scene_first.get(first["scene"]):
                    clar += 3
                clar -= 4 * (len(scenes) - 1)
                clar -= max(0, len(chars) - 3) * 2
                clar = max(4, min(20, clar))
                total = hook + cliff + emo + clar
                windows.append((total, i, j, hook_el, round(hook), round(cliff), round(emo), round(clar), scenes))

        windows.sort(key=lambda w: -w[0])
        chosen = []
        for w in windows:
            _, i, j = w[0], w[1], w[2]
            overlap = any(not (j < ci or i > cj) and (min(j, cj) - max(i, ci) + 1) / (j - i + 1) > 0.34
                          for _, ci, cj, *_ in chosen)
            if overlap:
                continue
            chosen.append(w)
            if len(chosen) >= n_max:
                break

        out = []
        for total, i, j, hook_el, h, c, e, cl, scenes in chosen:
            first, last = els[i], els[j]
            words = sorted({x for x in _words(" ".join(x.get("text", "") for x in els[i:j + 1])) if x in REVEAL},
                           key=lambda x: -REVEAL[x])[:3]
            patterns = []
            txt = " ".join(x.get("text", "").lower() for x in els[i:j + 1])
            for key, label in [("alive", "Return from the dead"), ("forg", "Forgery exposed"),
                               ("slap", "Physical confrontation"), ("daughter", "Hidden lineage reveal"),
                               ("granddaughter", "Hidden lineage reveal"),
                               ("lie", "Accusation of lies"), ("truth", "Truth confrontation"),
                               ("police", "Villain downfall"), ("secret", "Secret teased"),
                               ("record", "Evidence twist"), ("tape", "Evidence twist"),
                               ("fiancé", "Love triangle"), ("engaged", "Love triangle"), ("fire", "Past trauma")]:
                if key in txt and label not in patterns:
                    patterns.append(label)
            if not patterns:
                patterns = ["Dramatic confrontation"]
            out.append({
                "title": f"{patterns[0]}" + (f" — {hook_el['character'].title()}" if hook_el.get("character") else ""),
                "segments": [{"start_line_id": first["id"], "end_line_id": last["id"],
                              "start": first["start"], "end": last["end"]}],
                "hook": {"line_id": hook_el["id"], "quote": hook_el.get("text", "")},
                "cliffhanger": {"line_id": last["id"], "quote": last.get("text", "")},
                "explanation": (
                    f"Rule-based baseline: window opens on a high-intensity line ({hook_el['id']}) and closes on "
                    f"{last['id']}{' at a scene boundary' if last['id'] == scene_last.get(last['scene']) else ''}. "
                    f"Keyword signals: {', '.join(words) or 'none'}. Spans {len(scenes)} scene(s)."
                ),
                "patterns": patterns[:3],
                "scores": {"hook_strength": h, "cliffhanger_strength": c,
                           "emotional_impact": e, "standalone_clarity": cl},
            })
        return json.dumps({"candidates": out}, ensure_ascii=False)
