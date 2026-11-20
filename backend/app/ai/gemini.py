"""Google Gemini provider (REST, no SDK dependency).

The API key is read only from the server-side environment variable
GEMINI_API_KEY (or GOOGLE_API_KEY). It is never stored in the database or sent
to the browser."""
from __future__ import annotations

import os

import httpx

from .base import AIProvider, ProviderError

API_ROOT = "https://generativelanguage.googleapis.com/v1beta"

SUGGESTED_MODELS = [
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash",
]


def _key() -> str | None:
    return os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")


class GeminiProvider(AIProvider):
    id = "gemini"
    label = "Google Gemini"
    is_llm = True

    def configured(self) -> bool:
        return bool(_key())

    def status(self) -> dict:
        k = _key()
        return {
            "id": self.id,
            "label": self.label,
            "configured": bool(k),
            "env_var": "GEMINI_API_KEY",
            "key_hint": f"••••{k[-4:]}" if k and len(k) > 8 else None,
            "suggested_models": SUGGESTED_MODELS,
            "is_llm": True,
        }

    def _client(self) -> httpx.Client:
        return httpx.Client(timeout=httpx.Timeout(120.0, connect=15.0))

    def list_models(self) -> list[str]:
        k = _key()
        if not k:
            raise ProviderError("GEMINI_API_KEY is not set on the server.")
        try:
            with self._client() as c:
                r = c.get(f"{API_ROOT}/models", headers={"x-goog-api-key": k}, params={"pageSize": 200})
        except httpx.HTTPError as e:
            raise ProviderError(f"Could not reach Gemini API: {e}") from e
        if r.status_code != 200:
            raise ProviderError(f"Gemini API returned {r.status_code}: {r.text[:300]}")
        out = []
        for m in r.json().get("models", []):
            if "generateContent" in m.get("supportedGenerationMethods", []):
                out.append(m["name"].removeprefix("models/"))
        return sorted(out)

    def generate(self, prompt: str, context: dict, settings: dict) -> str:
        k = _key()
        if not k:
            raise ProviderError("GEMINI_API_KEY is not set on the server. Configure it in backend/.env and restart.")
        model = settings.get("model") or "gemini-2.5-flash"
        body = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": float(settings.get("temperature", 0.4)),
                "responseMimeType": "application/json",
            },
        }
        try:
            with self._client() as c:
                r = c.post(f"{API_ROOT}/models/{model}:generateContent", headers={"x-goog-api-key": k}, json=body)
        except httpx.HTTPError as e:
            raise ProviderError(f"Network error calling Gemini: {e}") from e
        if r.status_code != 200:
            try:
                msg = r.json().get("error", {}).get("message", r.text)
            except ValueError:
                msg = r.text
            raise ProviderError(f"Gemini API error {r.status_code}: {msg[:400]}")
        data = r.json()
        cands = data.get("candidates") or []
        if not cands:
            fb = data.get("promptFeedback", {})
            raise ProviderError(f"Gemini returned no candidates (feedback: {fb}).")
        parts = cands[0].get("content", {}).get("parts", [])
        text = "".join(p.get("text", "") for p in parts)
        if not text.strip():
            raise ProviderError(f"Gemini returned an empty response (finishReason={cands[0].get('finishReason')}).")
        return text
