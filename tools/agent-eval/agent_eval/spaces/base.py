"""The ACTION SPACE seam — how an agent reaches the site.

A space turns the current observation into typed closed-set questions
(`pose`), executes the decider's answer (`act`), and hands its collected
evidence to the final-answer step. The loop never knows which protocol it is
driving; a new protocol is a new registered space (Open/Closed).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from ..deciders import Decision
from ..text import TextHelper

DONE = "DONE"
BLOCKED = "BLOCKED"

DONE_LABEL = "Every requirement of the goal is satisfied, or the goal's answer is visible in the evidence."
BLOCKED_LABEL = "No offered operation can make progress."


@dataclass
class Pose:
    """What the decider sees this step."""

    state: dict
    questions: dict


@dataclass
class Outcome:
    kind: str  # "continue" | "done" | "blocked"
    event: dict
    text_calls: list[dict] = field(default_factory=list)


@dataclass
class Target:
    """Where a run starts: the workspace, the task's app, and its session."""

    base: str  # gateway origin reachable from here, e.g. http://localhost:8090
    workspace: str
    app: str
    cookies: list[dict]  # CDP cookie params for the app's session

    @property
    def app_url(self) -> str:
        return f"{self.base}/w/{self.workspace}/{self.app}/"


class ActionSpace(Protocol):
    name: str
    #: The corpus surface this space drives ("pages" | "tools" | "nlweb"); a
    #: task runs here only if its `surfaces` include it.
    surface: str

    def open(self, target: Target) -> None: ...

    def pose(self, goal: str, history: list[dict]) -> Pose: ...

    def act(self, decision: Decision, goal: str, history: list[dict], text: TextHelper) -> Outcome: ...

    def evidence(self, history: list[dict]) -> dict: ...

    def close(self) -> None: ...


def operation_question(goal: str, operations: dict[str, str], rules: str) -> dict:
    return {"type": "choice", "criteria": operations, "instructions": {"goal": goal, "rules": rules}}
