"""Robust screenplay parser for REELMIND AI.

Handles several screenplay layouts seen in microdrama scripts. It does not
assume an identical structure across files. Dialogue/action text and timestamp
strings are preserved exactly as written (only surrounding whitespace is trimmed).

Supported variations (mixable within a file):
  * Header:   "EPISODE NUMBER: 1" | "EPISODE 4" | "Episode No. 5" | "EP #2"
  * Logline:  "EPISODE LOGLINE: ..." | "LOGLINE: ..." | "Logline - ..."
  * Notes:    "CONTINUITY NOTES:" followed by bullets, or inline text
  * Scenes:   "SCENE 1: INT. X - NIGHT" + "SCENE START: t | SCENE END: t"
              "SCENE 2 - EXT. X - NIGHT (t - t)"
              "SCENE 1 | INT. X - DAY | t --> t"
              bare sluglines "INT. X - DAY"
  * Elements: "[t - t] ACTION: text" | "[t - t] NAME: text"
              "ACTION (t - t)" / "NAME (t - t)" followed by text lines
              "t --> t  NAME  text"
  * Camera:   "CAMERA: ..." | "CAMERA - ..."
Timestamps: HH:MM:SS, MM:SS, optional .mmm / ,mmm fractions.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field, asdict
from typing import Optional

TS = r"\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?"
SEP = r"\s*(?:-->|->|–|—|-|to)\s*"
RANGE_RE = re.compile(rf"[\[\(]?\s*({TS}){SEP}({TS})\s*[\]\)]?")

EPISODE_RE = re.compile(r"^\s*EP(?:ISODE)?\.?\s*(?:NUMBER|NUM|NO\.?|#)?\s*[:\-–#.]?\s*(?:EP(?:ISODE)?\.?\s*(?:NO\.?|#)?\s*)?(\d+)\b", re.I)
LOGLINE_RE = re.compile(r"^\s*(?:EPISODE\s+)?LOG\s?LINE\s*[:\-–]?\s*(.*)$", re.I)
CONT_RE = re.compile(r"^\s*CONTINUITY(?:\s+NOTES?)?\s*[:\-–]?\s*(.*)$", re.I)
TITLE_RE = re.compile(r"^\s*(?:EPISODE\s+)?TITLE\s*[:\-–]\s*(.+)$", re.I)
SCENE_RE = re.compile(r"^\s*SCENE\s*#?\s*(\d+)?\s*[:\-–|.]?\s*(.*)$", re.I)
SLUG_RE = re.compile(r"^\s*(INT\.|EXT\.|INT/EXT\.?|I/E\.?)\s+.+", re.I)
SCENE_BOUND_RE = re.compile(rf"(?:SCENE\s+)?(START|END)\s*[:\-–]?\s*({TS})", re.I)
CAMERA_RE = re.compile(r"^\s*\[?(?:CAMERA|CAM|SHOT)\]?\s*(?:[:\-–]\s*|\s+)(.*)$", re.I)
ACTION_WORD_RE = re.compile(r"^\s*(?:ACTION|ACT|DESCRIPTION)\b\s*[:\-–]?\s*(.*)$", re.I)
# NAME, optional "(V.O.)"-style extension, optional parenthetical, then : or - or 2+ spaces
SPEAKER_RE = re.compile(
    r"^\s*([A-Z][A-Z0-9 .'&\-]{0,40}?(?:\s*\((?:V\.O\.|O\.S\.|O\.C\.|CONT'D|VO|OS)\))?)\s*(?::|\s-\s|\s{2,})\s*(.+)$"
)
SPEAKER_ONLY_RE = re.compile(
    r"^\s*([A-Z][A-Z0-9 .'&\-]{0,40}?(?:\s*\((?:V\.O\.|O\.S\.|O\.C\.|CONT'D|VO|OS)\))?)\s*$"
)
PAREN_RE = re.compile(r"^\s*\(([^)]*)\)\s*$")
BULLET_RE = re.compile(r"^\s*(?:[-*•]|\d+[.)])\s+(.*)$")
# Block layout: "**LABEL (emotion):**" header, then "Start: (t) | End: (t)", then text lines
BLOCK_RE = re.compile(r"^\s*\*\*\s*(.+?)\s*:?\s*\*\*\s*:?\s*(.*)$")
TIMING_RE = re.compile(rf"^\s*START\s*[:\-–]?\s*\(?\s*({TS})\s*\)?\s*[|,;/]?\s*END\s*[:\-–]?\s*\(?\s*({TS})\s*\)?\s*$", re.I)
HEADING_RE = re.compile(r"^\s*(?:SCENE\s+)?(?:HEADING|SLUG(?:LINE)?|LOCATION)\s*[:\-–]\s*(.+)$", re.I)
IGNORE_RE = re.compile(r"^\s*(?:-{2,}\s*SCRIPT\s+(?:START|END)\s*-{2,}|ACTIONS?\s+(?:AND|&)\s+DIALOGUE\s*:?)\s*$", re.I)
EXTENSIONS = {"V.O.", "O.S.", "O.C.", "CONT'D", "VO", "OS", "OC", "CONTD", "PRE-LAP", "FILTERED"}
SOUND_LABELS = {"SOUND", "SOUND FX", "SFX", "SOUND EFFECT", "SOUND EFFECTS", "MUSIC", "AUDIO"}


def ts_to_seconds(ts: str) -> float:
    ts = ts.strip().replace(",", ".")
    frac = 0.0
    if "." in ts:
        ts, f = ts.split(".", 1)
        frac = float("0." + f)
    parts = [int(p) for p in ts.split(":")]
    if len(parts) == 2:
        h, m, s = 0, parts[0], parts[1]
    else:
        h, m, s = parts
    return h * 3600 + m * 60 + s + frac


def seconds_to_ts(sec: float) -> str:
    sec = max(0, sec)
    h = int(sec // 3600)
    m = int((sec % 3600) // 60)
    s = sec - h * 3600 - m * 60
    if abs(s - round(s)) < 1e-6:
        return f"{h:02d}:{m:02d}:{int(round(s)):02d}"
    return f"{h:02d}:{m:02d}:{s:06.3f}"


@dataclass
class Element:
    id: str
    kind: str  # "dialogue" | "action"
    text: str
    start: Optional[str] = None
    end: Optional[str] = None
    start_s: Optional[float] = None
    end_s: Optional[float] = None
    character: Optional[str] = None
    parenthetical: Optional[str] = None
    scene_number: int = 0
    source_line: int = 0
    raw: str = ""


@dataclass
class Scene:
    number: int
    heading: str
    start: Optional[str] = None
    end: Optional[str] = None
    start_s: Optional[float] = None
    end_s: Optional[float] = None
    camera: list[str] = field(default_factory=list)
    elements: list[Element] = field(default_factory=list)
    source_line: int = 0
    inferred_bounds: bool = False


@dataclass
class ParsedEpisode:
    episode_number: Optional[int]
    logline: str = ""
    title: str = ""
    continuity_notes: list[str] = field(default_factory=list)
    scenes: list[Scene] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    def all_elements(self) -> list[Element]:
        return [e for s in self.scenes for e in s.elements]

    @property
    def duration_s(self) -> float:
        ends = [s.end_s for s in self.scenes if s.end_s is not None]
        ends += [e.end_s for e in self.all_elements() if e.end_s is not None]
        return max(ends) if ends else 0.0

    def to_dict(self) -> dict:
        d = asdict(self)
        d["duration_s"] = self.duration_s
        d["element_count"] = len(self.all_elements())
        d["dialogue_count"] = sum(1 for e in self.all_elements() if e.kind == "dialogue")
        return d


def _find_range(line: str):
    m = RANGE_RE.search(line)
    if not m:
        return None
    return m.group(1), m.group(2), m


def _clean_heading(text: str) -> str:
    text = re.sub(r"[\s|:\-–]+$", "", text.strip())
    text = re.sub(r"^[\s|:\-–]+", "", text)
    return text.strip()


def split_speaker(label: str) -> tuple[str, Optional[str]]:
    """'JULIANA (V.O.) (Reflective, Vulnerable)' -> ('JULIANA (V.O.)', 'Reflective, Vulnerable')."""
    name = re.sub(r"\(.*?\)", "", label).strip()
    ext, notes = [], []
    for grp in re.findall(r"\(([^)]*)\)", label):
        for part in re.split(r"\s*/\s*", grp):
            if not part:
                continue
            (ext if part.strip().upper() in EXTENSIONS else notes).append(part.strip())
    if ext:
        name += " " + " ".join(f"({e})" for e in ext)
    return name, (", ".join(notes) or None)


def parse_screenplay(text: str, filename: str = "") -> ParsedEpisode:
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    ep = ParsedEpisode(episode_number=None)
    scene: Optional[Scene] = None
    pending: Optional[Element] = None  # element whose text follows on later lines
    last_el: Optional[Element] = None
    mode = "header"  # header | continuity | body
    counter = 0

    def new_scene(num: Optional[int], heading: str, lineno: int) -> Scene:
        nonlocal scene
        n = num if num is not None else (len(ep.scenes) + 1)
        scene = Scene(number=n, heading=heading, source_line=lineno)
        ep.scenes.append(scene)
        return scene

    def ensure_scene(lineno: int) -> Scene:
        if scene is None:
            ep.warnings.append(f"Line {lineno}: element found before any SCENE heading; created implicit Scene 1.")
            return new_scene(1, "(untitled scene)", lineno)
        return scene

    def add_element(kind, txt, start, end, lineno, raw, character=None, paren=None) -> Element:
        nonlocal counter, last_el
        sc = ensure_scene(lineno)
        counter += 1
        el = Element(
            id=f"L{counter:03d}", kind=kind, text=txt, start=start, end=end,
            start_s=ts_to_seconds(start) if start else None,
            end_s=ts_to_seconds(end) if end else None,
            character=character, parenthetical=paren, scene_number=sc.number,
            source_line=lineno, raw=raw,
        )
        sc.elements.append(el)
        last_el = el
        return el

    for idx, raw in enumerate(lines, start=1):
        line = raw.rstrip()
        stripped = line.strip()
        if not stripped:
            if pending is not None and pending.text:
                pending = None
            continue
        if re.fullmatch(r"[=\-_*~]{3,}", stripped):
            continue

        # ---------- header metadata ----------
        m = LOGLINE_RE.match(stripped)
        if m:
            ep.logline = m.group(1).strip()
            mode = "header"
            continue
        m = TITLE_RE.match(stripped)
        if m and not ep.title:
            ep.title = m.group(1).strip()
            continue
        m = CONT_RE.match(stripped)
        if m:
            mode = "continuity"
            if m.group(1).strip():
                ep.continuity_notes.append(m.group(1).strip())
            continue
        if ep.episode_number is None and not ep.scenes:
            m = EPISODE_RE.match(stripped)
            if m and not SCENE_RE.match(stripped):
                ep.episode_number = int(m.group(1))
                rest = stripped[m.end():].strip(" :-–|")
                if rest and not ep.title:
                    ep.title = rest
                continue

        if IGNORE_RE.match(stripped):
            pending = None
            mode = "body"
            continue

        hm = HEADING_RE.match(stripped)
        if hm and scene is not None and not scene.elements:
            scene.heading = _clean_heading(hm.group(1))
            mode = "body"
            continue

        # ---------- block layout: timing line for the pending block ----------
        tm = TIMING_RE.match(stripped)
        if tm and pending is not None and pending.start is None:
            pending.start, pending.end = tm.group(1), tm.group(2)
            pending.start_s, pending.end_s = ts_to_seconds(tm.group(1)), ts_to_seconds(tm.group(2))
            pending.raw += "\n" + raw
            continue

        bm = BLOCK_RE.match(stripped)
        if bm:
            mode = "body"
            label, inline = bm.group(1).strip().rstrip(":").strip(), bm.group(2).strip()
            base = re.sub(r"\(.*?\)", "", label).strip().upper()
            if base in ("CAMERA", "CAM", "SHOT"):
                pending = add_element("camera", inline, None, None, idx, raw)
            elif base in ("ACTION", "ACT", "DESCRIPTION"):
                pending = add_element("action", inline, None, None, idx, raw)
            elif base in SOUND_LABELS:
                pending = add_element("sound", inline, None, None, idx, raw)
            else:
                name, paren = split_speaker(label)
                pending = add_element("dialogue", inline, None, None, idx, raw, character=name, paren=paren)
            continue

        # ---------- scene headings ----------
        is_scene_kw = re.match(r"^\s*SCENE\b(?!\s+(?:START|END|HEADING)\b)", stripped, re.I)
        if is_scene_kw or SLUG_RE.match(stripped):
            pending = None
            mode = "body"
            rng = _find_range(stripped)
            work = stripped
            if rng:
                work = (stripped[: rng[2].start()] + stripped[rng[2].end():])
            num = None
            heading = work
            if is_scene_kw:
                sm = SCENE_RE.match(work)
                if sm:
                    num = int(sm.group(1)) if sm.group(1) else None
                    heading = sm.group(2)
            sc = new_scene(num, _clean_heading(heading), idx)
            if rng:
                sc.start, sc.end = rng[0], rng[1]
                sc.start_s, sc.end_s = ts_to_seconds(rng[0]), ts_to_seconds(rng[1])
            continue

        # SCENE START / END lines
        bounds = SCENE_BOUND_RE.findall(stripped)
        if bounds and re.match(r"^\s*(?:SCENE\s+)?(?:START|END)\b", stripped, re.I):
            sc = ensure_scene(idx)
            for which, t in bounds:
                if which.upper() == "START":
                    sc.start, sc.start_s = t, ts_to_seconds(t)
                else:
                    sc.end, sc.end_s = t, ts_to_seconds(t)
            continue

        # ---------- continuity bullets ----------
        if mode == "continuity":
            b = BULLET_RE.match(stripped)
            if b:
                ep.continuity_notes.append(b.group(1).strip())
                continue
            if not _find_range(stripped) and not CAMERA_RE.match(stripped):
                ep.continuity_notes.append(stripped)
                continue
            mode = "body"

        # ---------- camera ----------
        cm = CAMERA_RE.match(stripped)
        if cm and not _find_range(stripped):
            ensure_scene(idx).camera.append(cm.group(1).strip())
            pending = None
            continue

        # ---------- timed elements ----------
        rng = _find_range(stripped)
        if rng:
            start, end, rm = rng
            before = stripped[: rm.start()].strip()
            after = stripped[rm.end():].strip()
            after = re.sub(r"^[:\-–|]\s*", "", after)
            # Layout B: "NAME (t - t)" or "ACTION (t - t)" with text on following lines
            if before and not after:
                label = before.rstrip(":- ").strip()
                if ACTION_WORD_RE.match(label) and not ACTION_WORD_RE.match(label).group(1):
                    pending = add_element("action", "", start, end, idx, raw)
                elif CAMERA_RE.match(label):
                    pending = None
                    ensure_scene(idx).camera.append(label)
                else:
                    pending = add_element("dialogue", "", start, end, idx, raw, character=label)
                continue
            body = after if after else before
            am = ACTION_WORD_RE.match(body)
            if am:
                add_element("action", am.group(1).strip(), start, end, idx, raw)
                pending = None
                continue
            cmm = CAMERA_RE.match(body)
            if cmm:
                ensure_scene(idx).camera.append(cmm.group(1).strip())
                continue
            sm = SPEAKER_RE.match(body)
            if sm:
                name = sm.group(1).strip()
                txt = sm.group(2).strip()
                paren = None
                pm = re.match(r"^\(([^)]*)\)\s*(.*)$", txt)
                if pm and pm.group(2):
                    paren, txt = pm.group(1), pm.group(2)
                add_element("dialogue", txt, start, end, idx, raw, character=name, paren=paren)
            else:
                add_element("action", body, start, end, idx, raw)
                ep.warnings.append(f"Line {idx}: timed line without ACTION/character label treated as action.")
            pending = None
            continue

        # ---------- untimed continuation lines ----------
        if pending is not None:
            pm = PAREN_RE.match(stripped)
            if pm and pending.kind == "dialogue" and not pending.text:
                pending.parenthetical = pm.group(1)
            else:
                pending.text = (pending.text + " " + stripped).strip() if pending.text else stripped
            pending.raw += "\n" + raw
            continue

        # untimed speaker-only line followed by dialogue (no timestamps): record without timing
        if SPEAKER_ONLY_RE.match(stripped) and scene is not None and len(stripped) <= 40:
            pending = add_element("dialogue", "", None, None, idx, raw, character=stripped)
            ep.warnings.append(f"Line {idx}: dialogue for {stripped} has no timestamp.")
            continue

        if scene is not None and last_el is not None and last_el.source_line == idx - 1:
            last_el.text += " " + stripped
            last_el.raw += "\n" + raw
            continue

        if scene is not None:
            add_element("action", stripped, None, None, idx, raw)
            ep.warnings.append(f"Line {idx}: untimed action line.")
        else:
            ep.warnings.append(f"Line {idx}: unrecognised header line ignored: {stripped[:60]}")

    # ---------- post-processing & sanity checks ----------
    if ep.episode_number is None:
        m = re.search(r"(?:ep(?:isode)?[\s_\-]*)(\d+)", filename, re.I) or re.search(r"(\d+)", filename)
        if m:
            ep.episode_number = int(m.group(1))
            ep.warnings.append(f"Episode number not found in script; inferred {ep.episode_number} from filename.")
        else:
            ep.errors.append("Episode number not found in script or filename.")
    if not ep.logline:
        ep.warnings.append("No logline found.")
    if not ep.scenes:
        ep.errors.append("No scenes found.")

    for sc in ep.scenes:
        timed = [e for e in sc.elements if e.start_s is not None]
        if sc.start_s is None and timed:
            sc.start_s = min(e.start_s for e in timed)
            sc.start = seconds_to_ts(sc.start_s)
            sc.inferred_bounds = True
            ep.warnings.append(f"Scene {sc.number}: start time inferred from first element.")
        if sc.end_s is None and timed:
            sc.end_s = max(e.end_s for e in timed if e.end_s is not None)
            sc.end = seconds_to_ts(sc.end_s)
            sc.inferred_bounds = True
            ep.warnings.append(f"Scene {sc.number}: end time inferred from last element.")
        if not sc.elements:
            ep.warnings.append(f"Scene {sc.number}: contains no action or dialogue.")
        for e in sc.elements:
            if e.kind == "dialogue" and not e.text:
                ep.warnings.append(f"{e.id} ({e.character}): dialogue with no text.")
            if e.start_s is not None and e.end_s is not None:
                if e.end_s < e.start_s:
                    ep.warnings.append(f"{e.id}: end time {e.end} is before start time {e.start}.")
                elif e.end_s == e.start_s:
                    ep.warnings.append(f"{e.id}: zero-length element at {e.start}.")
            if sc.start_s is not None and sc.end_s is not None and e.start_s is not None:
                if e.start_s < sc.start_s - 0.01 or (e.end_s or 0) > sc.end_s + 0.01:
                    ep.warnings.append(f"{e.id}: timestamps fall outside Scene {sc.number} bounds.")
    timed_all = [e for e in ep.all_elements() if e.start_s is not None]
    for a, b in zip(timed_all, timed_all[1:]):
        if b.start_s < a.start_s:
            ep.warnings.append(f"{b.id}: starts before preceding element {a.id} (non-chronological).")
    if ep.scenes and not timed_all:
        ep.errors.append("No timestamped dialogue or action found.")
    return ep
