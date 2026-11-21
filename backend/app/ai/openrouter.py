"""OpenRouter provider (OpenAI-compatible chat completions, REST).

Gives access to many models (Gemma, Llama, Gemini, Claude, ...) with one key.
The key is read only from the server-side environment variable
OPENROUTER_API_KEY. It is never stored in the database or sent to the browser."""
from __future__ import annotations

import os
import time

import httpx

from .base import AIProvider, ProviderError

API_ROOT = "https://openrouter.ai/api/v1"

SUGGESTED_MODELS = [
    "google/gemma-4-26b-a4b-it:free",
    "google/gemma-4-31b-it:free",
    "google/gemini-2.5-flash",
    "google/gemma-4-26b-a4b-it",
]


def _key() -> str | None:
    return os.getenv("OPENROUTER_API_KEY")


class OpenRouterProvider(AIProvider):
    id = "openrouter"
    label = "OpenRouter"
    is_llm = True

    def configured(self) -> bool:
        return bool(_key())

    def status(self) -> dict:
        k = _key()
        return {
            "id": self.id,
            "label": self.label,
            "configured": bool(k),
            "env_var": "OPENROUTER_API_KEY",
            "key_hint": f"••••{k[-4:]}" if k and len(k) > 8 else None,
            "suggested_models": SUGGESTED_MODELS,
            "is_llm": True,
        }

    def _client(self) -> httpx.Client:
        return httpx.Client(timeout=httpx.Timeout(180.0, connect=15.0))

    def _headers(self, k: str) -> dict:
        return {
            "Authorization": f"Bearer {k}",
            "HTTP-Referer": "https://reelmind-ai.netlify.app",
            "X-Title": "REELMIND AI",
        }

    def list_models(self) -> list[str]:
        try:
            with self._client() as c:
                r = c.get(f"{API_ROOT}/models")
        except httpx.HTTPError as e:
            raise ProviderError(f"Could not reach OpenRouter: {e}") from e
        if r.status_code != 200:
            raise ProviderError(f"OpenRouter returned {r.status_code}: {r.text[:300]}")
        ids = [m["id"] for m in r.json().get("data", [])]
        # Free models first, then the rest alphabetically.
        return sorted(ids, key=lambda i: (not i.endswith(":free"), i))

    def generate(self, prompt: str, context: dict, settings: dict) -> str:
        k = _key()
        if not k:
            raise ProviderError("OPENROUTER_API_KEY is not set on the server. Configure it in backend/.env and restart.")
        model = settings.get("model") or SUGGESTED_MODELS[0]
        body = {
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": float(settings.get("temperature", 0.4)),
            "response_format": {"type": "json_object"},
        }
        try:
            with self._client() as c:
                for attempt, wait in enumerate((0, 8, 20, 40)):
                    if wait:
                        time.sleep(wait)  # free models are often briefly rate-limited upstream
                    r = c.post(f"{API_ROOT}/chat/completions", headers=self._headers(k), json=body)
                    if r.status_code == 400 and "response_format" in r.text and "response_format" in body:
                        body.pop("response_format")  # some models reject JSON mode; prompt still demands JSON
                        r = c.post(f"{API_ROOT}/chat/completions", headers=self._headers(k), json=body)
                    if r.status_code not in (429, 502, 503) and '"code":429' not in r.text.replace(" ", ""):
                        break
        except httpx.HTTPError as e:
            raise ProviderError(f"Network error calling OpenRouter: {e}") from e
        try:
            data = r.json()
        except ValueError:
            raise ProviderError(f"OpenRouter returned {r.status_code} with a non-JSON body: {r.text[:300]}")
        if r.status_code != 200 or "error" in data:
            err = data.get("error") or {}
            msg = err.get("message") if isinstance(err, dict) else str(err)
            code = err.get("code", r.status_code) if isinstance(err, dict) else r.status_code
            hint = " (rate-limited: free models are shared; retry later or pick the paid variant without ':free')" if code == 429 else ""
            raise ProviderError(f"OpenRouter error {code}: {(msg or r.text)[:400]}{hint}")
        choices = data.get("choices") or []
        if not choices:
            raise ProviderError("OpenRouter returned no choices.")
        text = (choices[0].get("message") or {}).get("content") or ""
        if not text.strip():
            raise ProviderError(f"OpenRouter returned an empty response (finish_reason={choices[0].get('finish_reason')}).")
        return text
