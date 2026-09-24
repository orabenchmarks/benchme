"""The ACTION SPACE seam — how an agent reaches the site.

A space turns the current observation into typed closed-set questions
(`pose`), executes the decider's answer (`act`), and hands its collected
evidence to the final-answer step. The loop never knows which protocol it is
driving; a new protocol is a new registered space (Open/Closed).
"""

from __future__ import annotations

import json
import time
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


def ensure_session(browser, target: Target) -> list[str]:
    """Prove the page is signed in before the decider sees anything.

    Checked from INSIDE the page (its own cookies): `<app>/account` answers 200
    signed in, a redirect signed out. A missing session is re-applied on the
    page's own target and the page reloaded once; if it is still missing the
    run is an environment failure, never a decider failure. Returns notes.
    """
    if not target.cookies:
        return []  # a read-only app (the vault) has no accounts

    def signed_in() -> bool:
        expression = (
            "fetch(%s, {redirect: 'manual', credentials: 'same-origin'})"
            ".then(r => r.type === 'opaqueredirect' ? 302 : r.status)"
        ) % json.dumps(target.app_url + "account")
        value = browser.call("Runtime.evaluate", expression=expression, awaitPromise=True, returnByValue=True)
        return value.get("result", {}).get("value") == 200

    if signed_in():
        return []
    for cookie in target.cookies:
        browser.call("Network.setCookie", **cookie)
    browser.call("Page.reload")
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline and browser.evaluate("document.readyState") != "complete":
        time.sleep(0.05)
    if not signed_in():
        raise EnvironmentError("session not applied to the page after a retry")
    return ["session re-applied once"]


def operation_question(goal: str, operations: dict[str, str], rules: str) -> dict:
    return {"type": "choice", "criteria": operations, "instructions": {"goal": goal, "rules": rules}}
