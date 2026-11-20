"""Provider interface. Every provider receives the same structured episode
context + prompt and must return raw text containing the JSON schema described
in app.ai.prompt. All validation happens afterwards in app.validation, so a
provider can be swapped without touching the rest of the pipeline."""
from __future__ import annotations

from abc import ABC, abstractmethod


class ProviderError(Exception):
    """Raised when a provider call fails. The pipeline records the failure and
    never substitutes fabricated results."""


class AIProvider(ABC):
    id: str = "base"
    label: str = "Base provider"
    is_llm: bool = True

    @abstractmethod
    def configured(self) -> bool: ...

    @abstractmethod
    def status(self) -> dict: ...

    @abstractmethod
    def generate(self, prompt: str, context: dict, settings: dict) -> str:
        """Return the raw model response text (expected to be JSON)."""

    def list_models(self) -> list[str]:
        return []
