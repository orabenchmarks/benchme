"""The agent loop — identical for every protocol and every decider.

observe → pose typed questions → decider answers (one round trip) → the space
executes (the text helper writes any text) → repeat, until DONE, BLOCKED, the
step budget, or the wall-clock budget. An answer task then gets its final
answer written from the collected evidence, and the verifier decides.
"""

from __future__ import annotations

import time
from dataclasses import asdict, dataclass, field

from .deciders import Decider, DecisionError
from .spaces.base import ActionSpace, Target
from .tasks import Task, verify
from .text import FINAL_ANSWER, TextError, TextHelper


@dataclass
class RunResult:
    protocol: str
    decider: str
    task: str
    repeat: int
    workspace: str
    verdict: str = "ERROR"  # OK | FAIL | ERROR
    end: str = ""  # done | blocked | step_budget | time_budget | error
    steps: int = 0
    decisions: int = 0
    invalid_decisions: int = 0
    decision_ms: int = 0
    decision_cost_usd: float = 0.0
    decider_tokens_in: int = 0
    text_calls: int = 0
    text_ms: int = 0
    text_cost_usd: float = 0.0
    ranker_ms: int = 0
    ranker_cost_usd: float = 0.0
    wall_ms: int = 0
    answer: dict | None = None
    error: str | None = None
    details: list = field(default_factory=list)
    history: list = field(default_factory=list)

    @property
    def cost_usd(self) -> float:
        return self.decision_cost_usd + self.text_cost_usd + self.ranker_cost_usd

    def to_json(self) -> dict:
        return {**asdict(self), "cost_usd": self.cost_usd}


def run_task(
    space: ActionSpace,
    decider: Decider,
    text: TextHelper,
    task: Task,
    target: Target,
    repeat: int,
    max_steps: int = 30,
    max_seconds: float = 240,
) -> RunResult:
    result = RunResult(space.name, decider.name, task.id, repeat, target.workspace)
    goal = task.intent
    history: list[dict] = []
    started = time.perf_counter()
    try:
        space.open(target)
        started = time.perf_counter()  # the clock starts once the site is loaded, as in jev-ultrafast
        for _ in range(max_steps):
            if time.perf_counter() - started > max_seconds:
                result.end = "time_budget"
                break
            pose = space.pose(goal, history)
            try:
                decision = decider.ask(pose.state, pose.questions)
            except DecisionError as err:
                # The decider refused or failed this step (e.g. an input limit):
                # that arm could not decide — a FAIL for the arm, not a harness error.
                result.invalid_decisions += 1
                history.append({"action": "DECIDER_ERROR", "kind": "decider_error", "error": str(err)[:300]})
                result.end = "decider_error"
                break
            result.decisions += 1
            result.decision_ms += decision.latency_ms
            result.decision_cost_usd += decision.cost_usd
            result.decider_tokens_in += decision.input_tokens
            try:
                outcome = space.act(decision, goal, history, text)
            except DecisionError as err:
                result.invalid_decisions += 1
                history.append({"action": "INVALID", "kind": "invalid", "error": str(err)})
                if result.invalid_decisions >= 3:
                    result.end = "blocked"
                    break
                continue
            for call in outcome.text_calls:
                result.text_calls += 1
                result.text_ms += call["latency_ms"]
                result.text_cost_usd += call["cost_usd"]
            result.ranker_ms += int(outcome.event.get("ranker_latency_ms") or 0)
            result.ranker_cost_usd += float(outcome.event.get("ranker_cost_usd") or 0)
            history.append(outcome.event)
            result.steps += 1
            if outcome.kind in {"done", "blocked"}:
                result.end = outcome.kind
                break
        else:
            result.end = "step_budget"
        if result.end == "decider_error":
            result.error = history[-1]["error"]
        if task.oracle == "json":
            result.answer = _final_answer(text, task, space.evidence(history), result)
        result.wall_ms = round((time.perf_counter() - started) * 1000)
        verdict = verify(target.base, target.workspace, task, result.answer)
        result.verdict, result.details = verdict["verdict"], verdict["details"]
    except Exception as err:  # noqa: BLE001 — a run's failure is data, not a crash of the benchmark
        result.wall_ms = round((time.perf_counter() - started) * 1000)
        result.end = result.end or "error"
        result.error = f"{type(err).__name__}: {err}"[:500]
    finally:
        result.history = history
        try:
            space.close()
        except Exception:  # noqa: BLE001
            pass
    return result


def _final_answer(text: TextHelper, task: Task, evidence: dict, result: RunResult) -> dict:
    try:
        written = text.json(FINAL_ANSWER, {"goal": task.intent, "answer_keys": list(task.answer_keys), "evidence": evidence})
    except TextError:
        return {}
    result.text_calls += 1
    result.text_ms += written.latency_ms
    result.text_cost_usd += written.cost_usd
    return {k: written.value[k] for k in task.answer_keys if k in written.value}
