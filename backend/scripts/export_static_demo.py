"""Export a read-only snapshot of the DEMO workspace for the static (Netlify) preview.

Usage:  python scripts/export_static_demo.py ../frontend/public/static-demo
Only demo data is exported — never live data.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

out = Path(sys.argv[1] if len(sys.argv) > 1 else "../frontend/public/static-demo").resolve()
out.mkdir(parents=True, exist_ok=True)
for old in out.glob("*"):
    if old.is_file():
        old.unlink()
H = {"X-Workspace": "demo"}

with TestClient(app) as c:
    c.post("/api/demo/reset")

    def save(name, path):
        r = c.get(path, headers=H)
        r.raise_for_status()
        (out / name).write_bytes(r.content)
        return r

    for name, path in [("health", "/api/health"), ("dashboard", "/api/dashboard"), ("episodes", "/api/episodes"),
                       ("promos", "/api/promos"), ("analytics", "/api/analytics"), ("evaluation", "/api/evaluation"),
                       ("settings", "/api/settings"), ("jobs", "/api/jobs"), ("activity", "/api/activity")]:
        save(f"{name}.json", path)
    for e in json.loads((out / "episodes.json").read_text()):
        save(f"episode_{e['id']}.json", f"/api/episodes/{e['id']}")
    save("promos.csv", "/api/export/promos.csv?workspace=demo")
    save("promos_export.json", "/api/export/promos.json?workspace=demo")
    save("outputs.zip", "/api/export/outputs.zip?workspace=demo")
print(f"Static demo snapshot written to {out}")
