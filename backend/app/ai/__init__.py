from .base import AIProvider, ProviderError
from .gemini import GeminiProvider
from .heuristic import HeuristicProvider

# Register new providers here (e.g. OpenAI, Anthropic) — they only need to
# implement AIProvider.generate() and return the shared JSON contract.
PROVIDERS: dict[str, AIProvider] = {
    p.id: p for p in (GeminiProvider(), HeuristicProvider())
}


def get_provider(pid: str) -> AIProvider:
    if pid not in PROVIDERS:
        raise ProviderError(f"Unknown AI provider '{pid}'. Available: {', '.join(PROVIDERS)}")
    return PROVIDERS[pid]


__all__ = ["AIProvider", "ProviderError", "PROVIDERS", "get_provider"]
