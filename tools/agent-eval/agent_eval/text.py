"""The TEXT helper — the small LLM that writes, never decides.

jev-ultrafast's split: the decider picks the operation and target; a small LLM
writes only the text an operation needs (a field value, a tool's arguments, a
search query, the final answer). The helper is IDENTICAL on both sides of every
pair, so a difference between arms is the decider's, not the writer's.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass

import httpx

from .deciders import RETRYABLE, _first_json


class TextError(ValueError):
    """The helper returned nothing usable; nothing is typed or called."""


@dataclass
class Written:
    value: dict
    latency_ms: int
    input_tokens: int
    output_tokens: int
    cost_usd: float


class TextHelper:
    def __init__(self, base_url: str, api_key: str, model: str, usd_per_mtok: tuple[float, float], max_tokens: int = 800):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.usd_in, self.usd_out = usd_per_mtok
        self.max_tokens = max_tokens
        self.client = httpx.Client(http2=True, timeout=60)

    def json(self, system: str, context: dict) -> Written:
        """One call; the reply must be a single JSON object."""
        started = time.perf_counter()
        body = {
            "model": self.model,
            "max_tokens": self.max_tokens,
            "temperature": 0,
            "system": system + " Reply with ONLY a JSON object, no prose, no code fence.",
            "messages": [{"role": "user", "content": json.dumps(context)}],
        }
        headers = {"x-api-key": self.api_key, "anthropic-version": "2023-06-01"}
        result = None
        for attempt in range(3):
            try:
                response = self.client.post(f"{self.base_url}/v1/messages", json=body, headers=headers)
            except httpx.HTTPError as err:
                if attempt == 2:
                    raise TextError(f"text helper unreachable: {err}") from None
                time.sleep(0.5 * 2**attempt)
                continue
            if response.status_code in RETRYABLE and attempt < 2:
                time.sleep(0.5 * 2**attempt)
                continue
            if response.is_error:
                raise TextError(f"text helper HTTP {response.status_code}")
            result = response.json()
            break
        if result is None:
            raise TextError("text helper unavailable")
        usage = result.get("usage") or {}
        tokens_in, tokens_out = int(usage.get("input_tokens") or 0), int(usage.get("output_tokens") or 0)
        parsed = _first_json("".join(b.get("text", "") for b in result.get("content") or []))
        if parsed is None:
            raise TextError("text helper returned no JSON object")
        return Written(
            value=parsed,
            latency_ms=round((time.perf_counter() - started) * 1000),
            input_tokens=tokens_in,
            output_tokens=tokens_out,
            cost_usd=(tokens_in * self.usd_in + tokens_out * self.usd_out) / 1e6,
        )


FINAL_ANSWER = (
    "You finish a web task. From the goal and the evidence collected so far, return the task's "
    "answer as a JSON object whose keys are exactly `answer_keys`. Values must come from the "
    "evidence; never invent them. Quantities and prices are JSON numbers; a list of identifiers is "
    "one comma-separated string in ascending order. If the evidence does not contain the answer, "
    "return {} (an empty object)."
)
