"""REELMIND AI — FastAPI application."""
from __future__ import annotations

import json
import os
from pathlib import Path

from fastapi import FastAPI, File, Header, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import db, services
from .ai import PROVIDERS, ProviderError, get_provider

try:
    from dotenv import load_dotenv  # optional
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except ImportError:
    env = Path(__file__).resolve().parent.parent / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

SAMPLE_DIR = Path(__file__).resolve().parent.parent / "sample_scripts"

app = FastAPI(title="REELMIND AI API", version="1.0.0")
origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["*"], allow_headers=["*"],
                   expose_headers=["Content-Disposition"])


def W(x_workspace: str | None) -> str:
    ws = (x_workspace or "live").lower()
    if ws not in db.WORKSPACES:
        raise HTTPException(400, f"Unknown workspace '{ws}'")
    return ws


def seed_demo(force: bool = False) -> None:
    ws = "demo"
    if force:
        for t in ("promos", "analysis_runs", "episodes", "jobs", "activity"):
            db.execute(ws, f"DELETE FROM {t}")
        for f in db.output_dir(ws).rglob("*"):
            if f.is_file():
                f.unlink()
    if db.query_one(ws, "SELECT id FROM episodes LIMIT 1"):
        return
    files = [(p.name, p.read_bytes()) for p in sorted(SAMPLE_DIR.glob("*.txt"))]
    services.ingest(ws, files)
    settings = db.get_settings(ws)
    prov = get_provider("heuristic")
    for ep in db.query(ws, "SELECT * FROM episodes WHERE status='parsed' ORDER BY episode_number"):
        services.analyse_episode(ws, None, ep, prov, "keyword-baseline-v1", settings)
        db.update(ws, "episodes", ep["id"], {"status": "analyzed"})
    db.log_activity(ws, "demo", "Demo workspace seeded with sample scripts + rule-based baseline analysis")
    services.rerank(ws)
    services.write_outputs(ws)


@app.on_event("startup")
def startup():
    for ws in db.WORKSPACES:
        db.init_db(ws)
        # jobs interrupted by a restart must not appear to be running forever
        db.execute(ws, "UPDATE jobs SET status='failed', error='Interrupted by server restart', finished_at=? "
                       "WHERE status IN ('queued','running')", (db.now(),))
        db.execute(ws, "UPDATE episodes SET status='analysis_failed', last_error='Interrupted by server restart' "
                       "WHERE status IN ('queued','analyzing')")
    seed_demo()


# ------------------------------------------------------------------ health
@app.get("/api/health")
def health():
    s = db.get_settings("live")
    p = PROVIDERS.get(s["provider"])
    return {"ok": True, "version": app.version, "provider": s["provider"], "model": s["model"],
            "provider_configured": bool(p and p.configured())}


# ---------------------------------------------------------------- episodes
@app.post("/api/episodes/upload")
async def upload(files: list[UploadFile] = File(...), x_workspace: str | None = Header(None)):
    ws = W(x_workspace)
    if ws == "demo":
        raise HTTPException(403, "Uploads are disabled in demo mode. Switch to the Live workspace.")
    payload = []
    for f in files:
        payload.append((f.filename or "upload.txt", await f.read()))
    return services.ingest(ws, payload)


@app.get("/api/episodes")
def episodes(search: str = "", status: str = "", x_workspace: str | None = Header(None)):
    eps = services.list_episodes(W(x_workspace))
    if search:
        q = search.lower()
        eps = [e for e in eps if q in (e["logline"] or "").lower() or q in (e["filename"] or "").lower()
               or q in (e["title"] or "").lower() or q == str(e["episode_number"])]
    if status:
        eps = [e for e in eps if e["status"] == status]
    return eps


@app.get("/api/episodes/{eid}")
def episode(eid: int, x_workspace: str | None = Header(None)):
    ws = W(x_workspace)
    e = db.query_one(ws, "SELECT * FROM episodes WHERE id = ?", (eid,))
    if not e:
        raise HTTPException(404, "Episode not found")
    e["promos"] = [p for p in services.list_promos(ws) if p["episode_id"] == eid]
    e["runs"] = db.query(ws, "SELECT id, job_id, provider, model, status, error, candidate_count, valid_count, created_at "
                             "FROM analysis_runs WHERE episode_id = ? ORDER BY id DESC", (eid,))
    return e


@app.delete("/api/episodes/{eid}")
def delete_episode(eid: int, x_workspace: str | None = Header(None)):
    ws = W(x_workspace)
    if ws == "demo":
        raise HTTPException(403, "Demo data is read-only. Use 'Reset demo' instead.")
    services.delete_episode(ws, eid)
    return {"ok": True}


# ---------------------------------------------------------------- analysis
class AnalysisRequest(BaseModel):
    episode_ids: list[int] | None = None
    provider: str | None = None
    model: str | None = None


@app.post("/api/analysis/run")
def run_analysis(req: AnalysisRequest, x_workspace: str | None = Header(None)):
    ws = W(x_workspace)
    if ws == "demo":
        raise HTTPException(403, "Analysis is disabled in demo mode. Switch to the Live workspace.")
    try:
        return services.start_analysis(ws, req.episode_ids, req.provider, req.model)
    except ProviderError as e:
        raise HTTPException(400, str(e))


@app.get("/api/jobs")
def jobs(x_workspace: str | None = Header(None)):
    return db.query(W(x_workspace), "SELECT * FROM jobs ORDER BY id DESC LIMIT 20")


@app.get("/api/jobs/{jid}")
def job(jid: int, x_workspace: str | None = Header(None)):
    j = db.query_one(W(x_workspace), "SELECT * FROM jobs WHERE id = ?", (jid,))
    if not j:
        raise HTTPException(404, "Job not found")
    return j


@app.get("/api/runs/{rid}")
def run(rid: int, x_workspace: str | None = Header(None)):
    r = db.query_one(W(x_workspace), "SELECT * FROM analysis_runs WHERE id = ?", (rid,))
    if not r:
        raise HTTPException(404, "Run not found")
    return r


# ------------------------------------------------------------------ promos
@app.get("/api/promos")
def promos(episode: int | None = None, min_score: float = 0, status: str = "", validity: str = "",
           sort: str = "score", x_workspace: str | None = Header(None)):
    ps = services.list_promos(W(x_workspace))
    if episode is not None:
        ps = [p for p in ps if p["episode_number"] == episode]
    ps = [p for p in ps if p["overall"] >= min_score]
    if status:
        ps = [p for p in ps if p["review_status"] == status]
    if validity:
        ps = [p for p in ps if p["validation_status"] == validity]
    if sort == "score_asc":
        ps.sort(key=lambda p: p["overall"])
    elif sort == "episode":
        ps.sort(key=lambda p: (p["episode_number"], p["start_s"] or 0))
    elif sort == "duration":
        ps.sort(key=lambda p: p["duration_s"] or 0)
    return ps


class PromoUpdate(BaseModel):
    editor_scores: dict[str, float | None] | None = None
    review_status: str | None = None
    review_notes: str | None = None


@app.patch("/api/promos/{pid}")
def patch_promo(pid: int, body: PromoUpdate, x_workspace: str | None = Header(None)):
    ws = W(x_workspace)
    if ws == "demo":
        raise HTTPException(403, "Demo data is read-only.")
    try:
        return services.update_promo(ws, pid, body.model_dump(exclude_unset=True))
    except KeyError:
        raise HTTPException(404, "Promo not found")
    except ValueError as e:
        raise HTTPException(400, str(e))


# --------------------------------------------------------------- aggregates
@app.get("/api/dashboard")
def dashboard(x_workspace: str | None = Header(None)):
    return services.dashboard(W(x_workspace))


@app.get("/api/analytics")
def analytics(x_workspace: str | None = Header(None)):
    return services.analytics(W(x_workspace))


@app.get("/api/evaluation")
def evaluation(x_workspace: str | None = Header(None)):
    return services.evaluation(W(x_workspace))


@app.get("/api/activity")
def activity(x_workspace: str | None = Header(None)):
    return db.query(W(x_workspace), "SELECT * FROM activity ORDER BY id DESC LIMIT 100")


# ------------------------------------------------------------------ exports
def _ids(ids: str | None) -> list[int] | None:
    return [int(x) for x in ids.split(",") if x.strip().isdigit()] if ids else None


@app.get("/api/export/promos.csv")
def export_csv(ids: str | None = None, workspace: str | None = Query(None), x_workspace: str | None = Header(None)):
    ws = W(workspace or x_workspace)
    s = db.get_settings(ws)
    rows = services.promo_rows(services.export_promos(ws, _ids(ids)))
    body = services.to_csv(rows, services.CSV_FIELDS, s.get("csv_delimiter", ","))
    return Response("﻿" + body, media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="reelmind_{ws}_promos.csv"'})


@app.get("/api/export/promos.json")
def export_json(ids: str | None = None, workspace: str | None = Query(None), x_workspace: str | None = Header(None)):
    ws = W(workspace or x_workspace)
    ps = services.export_promos(ws, _ids(ids))
    payload = {"workspace": ws, "generated_at": db.now(),
               "scoring": {"hook_strength": 30, "cliffhanger_strength": 30, "emotional_impact": 20, "standalone_clarity": 20,
                           "note": "Editorial promo-potential scores; not a prediction of views or virality."},
               "promos": ps}
    return Response(json.dumps(payload, ensure_ascii=False, indent=2), media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="reelmind_{ws}_promos.json"'})


@app.get("/api/export/outputs.zip")
def export_bundle(workspace: str | None = Query(None), x_workspace: str | None = Header(None)):
    ws = W(workspace or x_workspace)
    return Response(services.outputs_zip(ws), media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="reelmind_{ws}_outputs.zip"'})


# ----------------------------------------------------------------- settings
@app.get("/api/settings")
def get_settings(x_workspace: str | None = Header(None)):
    ws = W(x_workspace)
    return {"settings": db.get_settings(ws), "providers": [p.status() for p in PROVIDERS.values()]}


@app.put("/api/settings")
def put_settings(values: dict, x_workspace: str | None = Header(None)):
    ws = W(x_workspace)
    if ws == "demo":
        raise HTTPException(403, "Settings are read-only in demo mode.")
    if "provider" in values and values["provider"] not in PROVIDERS:
        raise HTTPException(400, "Unknown provider")
    for k in ("min_duration_s", "max_duration_s"):
        if k in values:
            values[k] = float(values[k])
    if float(values.get("min_duration_s", 20)) >= float(values.get("max_duration_s", 60)):
        raise HTTPException(400, "Minimum duration must be below maximum duration.")
    s = db.save_settings(ws, values)
    db.log_activity(ws, "settings", "Settings updated")
    return {"settings": s, "providers": [p.status() for p in PROVIDERS.values()]}


@app.get("/api/providers/{pid}/models")
def provider_models(pid: str):
    try:
        return {"models": get_provider(pid).list_models() or get_provider(pid).status()["suggested_models"]}
    except ProviderError as e:
        raise HTTPException(400, str(e))


class TestReq(BaseModel):
    provider: str
    model: str | None = None


@app.post("/api/providers/test")
def provider_test(req: TestReq):
    try:
        p = get_provider(req.provider)
        if not p.is_llm:
            return {"ok": True, "message": "Rule-based baseline runs locally; no API key required."}
        raw = p.generate('Reply with JSON exactly: {"ok": true}', {}, {"model": req.model, "temperature": 0})
        return {"ok": True, "message": f"Connected. Model replied: {raw.strip()[:120]}"}
    except ProviderError as e:
        return JSONResponse({"ok": False, "message": str(e)}, status_code=400)


@app.post("/api/demo/reset")
def demo_reset():
    seed_demo(force=True)
    return {"ok": True}


@app.post("/api/workspace/clear")
def clear_live(x_workspace: str | None = Header(None)):
    ws = W(x_workspace)
    if ws != "live":
        raise HTTPException(400, "Only the live workspace can be cleared.")
    for t in ("promos", "analysis_runs", "episodes", "jobs"):
        db.execute(ws, f"DELETE FROM {t}")
    db.log_activity(ws, "delete", "Live workspace cleared")
    services.write_outputs(ws)
    return {"ok": True}


# Serve the built frontend if present (single-process deployment).
DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        f = DIST / path
        if path and f.is_file():
            return FileResponse(f)
        return FileResponse(DIST / "index.html")
