"""The DECIDER seam — the one thing a pair of arms varies.

Every action space poses the same thing to whichever decider it is given: a
JSON `state` and a set of typed closed-set `questions` (TypeSafe's
`/v1/systemone` shape: `{id: {type: "choice", instructions, criteria}}`).
The decider answers every question in ONE round trip; the space then uses the
answers it needs (jev-ultrafast's speculative target heads).

- `JevDecider` asks TypeSafe jev natively.
- `LlmDecider` asks an Anthropic-compatible LLM the identical state and
  questions and requires strict JSON back — the like-for-like baseline.

Both report latency, token usage and cost, and raise `DecisionError` on an
answer that names no offered option, so an invalid answer is never executed.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Protocol

import httpx

RETRYABLE = {429, 500, 502, 503, 529}


class DecisionError(ValueError):
    """The decider produced no usable answer; nothing is executed."""


@dataclass
class Decision:
    answers: dict[str, dict]
    model: str
    latency_ms: int
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
    raw: dict = field(default_factory=dict)

    def choice(self, question_id: str) -> str:
        answer = self.answers.get(question_id)
        if not answer:
            raise DecisionError(f"no answer for {question_id}")
        return answer["choice"]

    def confidence(self, question_id: str) -> float | None:
        return (self.answers.get(question_id) or {}).get("confidence")


class Decider(Protocol):
    name: str

    def ask(self, state: dict, questions: dict) -> Decision: ...


def _post(client: httpx.Client, url: str, headers: dict, body: dict) -> dict:
    for attempt in range(3):
        try:
            response = client.post(url, json=body, headers=headers)
        except httpx.HTTPError as err:
            if attempt == 2:
                raise DecisionError(f"decider unreachable: {err}") from None
            time.sleep(0.5 * 2**attempt)
            continue
        if response.status_code in RETRYABLE and attempt < 2:
            time.sleep(0.5 * 2**attempt)
            continue
        if response.is_error:
            raise DecisionError(f"decider HTTP {response.status_code}: {response.text[:200]}")
        return response.json()
    raise DecisionError("decider unavailable")


def _validate(answers: dict, questions: dict) -> dict[str, dict]:
    """Keep only well-formed answers whose choice is an offered option id."""
    out: dict[str, dict] = {}
    for qid, question in questions.items():
        answer = answers.get(qid)
        if not isinstance(answer, dict):
            continue
        choice = answer.get("choice")
        if not isinstance(choice, str) or choice not in question["criteria"]:
            continue
        confidence = answer.get("confidence")
        if not isinstance(confidence, (int, float)):
            probabilities = answer.get("probabilities") or {}
            confidence = probabilities.get(choice)
        out[qid] = {"choice": choice, "confidence": confidence}
    return out


class JevDecider:
    """TypeSafe jev: typed choices over one state, one call."""

    def __init__(self, base_url: str, api_key: str, model: str = "jev-latest", usd_per_mtok_in: float = 0.042):
        self.name = "jev"
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.usd_per_mtok_in = usd_per_mtok_in
        self.client = httpx.Client(http2=True, timeout=30)

    def ask(self, state: dict, questions: dict) -> Decision:
        started = time.perf_counter()
        body = {"model": self.model, "state": state, "questions": questions}
        result = _post(self.client, f"{self.base_url}/v1/systemone", {"Authorization": f"Bearer {self.api_key}"}, body)
        usage = result.get("usage") or {}
        tokens_in = int(usage.get("input_tokens") or 0)
        return Decision(
            answers=_validate(result.get("answers") or {}, questions),
            model=result.get("model", self.model),
            latency_ms=round((time.perf_counter() - started) * 1000),
            input_tokens=tokens_in,
            output_tokens=int(usage.get("output_tokens") or 0),
            cost_usd=tokens_in * self.usd_per_mtok_in / 1e6,
            raw=result.get("answers") or {},
        )


LLM_SYSTEM = (
    "You are the decision component of a web agent. You receive a JSON state and several "
    "closed-set questions. Each question has `instructions` and `criteria`: a map from option id "
    "to what that option means. Answer EVERY question by picking exactly one option id from its "
    "criteria, using only the state and the instructions. Reply with ONLY a JSON object, no prose, "
    'no code fence: {"<question id>": {"choice": "<option id>", "confidence": <0..1>}, ...}.'
)


def _first_json(text: str) -> dict | None:
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        parsed = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


class LlmDecider:
    """An Anthropic-compatible LLM answering the identical state and questions."""

    def __init__(self, base_url: str, api_key: str, model: str, usd_per_mtok: tuple[float, float], max_tokens: int = 600):
        self.name = model
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.usd_in, self.usd_out = usd_per_mtok
        self.max_tokens = max_tokens
        self.client = httpx.Client(http2=True, timeout=60)

    def ask(self, state: dict, questions: dict) -> Decision:
        started = time.perf_counter()
        body = {
            "model": self.model,
            "max_tokens": self.max_tokens,
            "temperature": 0,
            "system": LLM_SYSTEM,
            "messages": [{"role": "user", "content": json.dumps({"state": state, "questions": questions})}],
        }
        headers = {"x-api-key": self.api_key, "anthropic-version": "2023-06-01"}
        result = _post(self.client, f"{self.base_url}/v1/messages", headers, body)
        usage = result.get("usage") or {}
        tokens_in, tokens_out = int(usage.get("input_tokens") or 0), int(usage.get("output_tokens") or 0)
        text = "".join(block.get("text", "") for block in result.get("content") or [])
        parsed = _first_json(text) or {}
        return Decision(
            answers=_validate(parsed, questions),
            model=self.model,
            latency_ms=round((time.perf_counter() - started) * 1000),
            input_tokens=tokens_in,
            output_tokens=tokens_out,
            cost_usd=(tokens_in * self.usd_in + tokens_out * self.usd_out) / 1e6,
            raw=parsed,
        )
