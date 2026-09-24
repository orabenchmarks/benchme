"""BROWSER — jev-ultrafast's own action space, with the decider swapped.

Everything but the decider is jev-ultrafast's, pinned: the atomic DOM snapshot,
the indexed element table, the operation + speculative target heads and their
instructions (NEXT_ACTION / TARGET), the text helper's contract (TEXT_VALUE),
and the guarded executor (freshness + occlusion checks). The question-building
below mirrors `jev_ultrafast.model.choose`, which couples it to one HTTP call.
"""

from __future__ import annotations

from browser_harness.admin import ensure_daemon
from browser_harness.helpers import cdp
from jev_ultrafast.browser import Browser, StalePage
from jev_ultrafast.model import action_space, field_context
from jev_ultrafast.questions import NEXT_ACTION, TARGET, TEXT_VALUE

from ..deciders import Decision, DecisionError
from ..text import TextError, TextHelper
from .base import BLOCKED, BLOCKED_LABEL, DONE, DONE_LABEL, Outcome, Pose, Target, ensure_session

#: Label cap for what the DECIDER sees (the executor always acts on the
#: original observed action). The one deviation from pinned jev-ultrafast: its
#: snapshot names a <select> after ALL its option text and repeats that name
#: inside every option, so one 39-option dropdown became ~50k characters and
#: exceeded jev's input limit. Both deciders get the same compact view.
LABEL_CHARS = 120


def _short(label: str) -> str:
    """An option's own text (after the select-name prefix), capped."""
    own = label.split(" → ")[-1]
    return own if len(own) <= LABEL_CHARS else own[: LABEL_CHARS - 1] + "…"


def _compact(elements: list[dict]) -> list[dict]:
    out = []
    for e in elements:
        e = {**e, "label": _short(e["label"])}
        if "options" in e:
            e["options"] = [{**o, "label": _short(o["label"])} for o in e["options"]]
        out.append(e)
    return out


OPERATION_LABELS = {
    "CLICK": "Click an element, button, menu option, autocomplete suggestion, or calendar day.",
    "TYPE_TEXT": "Enter or replace text in an editable field. A small LLM will supply the value from the goal.",
    "SELECT": "Select an observed dropdown value.",
}


class BrowserSpace:
    name = "browser"
    surface = "pages"

    def __init__(self) -> None:
        self.browser: Browser | None = None
        self.page: dict | None = None
        self._targets: dict = {}
        self._controls: dict = {}

    def open(self, target: Target) -> None:
        ensure_daemon()
        if target.cookies:
            cdp("Storage.setCookies", cookies=target.cookies)
        self.browser = Browser(target.app_url)
        self.setup_notes = ensure_session(self.browser, target)
        self.page = self.browser.observe(screenshot=False)

    def pose(self, goal: str, history: list[dict]) -> Pose:
        assert self.browser is not None
        if not self.browser.fresh(self.page):
            self.page = self.browser.observe(screenshot=False)
        elements, targets, controls = action_space(self.page["actions"])
        self._targets, self._controls = targets, controls
        operations = {key: OPERATION_LABELS[key] for key in targets}
        operations.update({key: value["label"] for key, value in controls.items()})
        operations.update({DONE: DONE_LABEL, BLOCKED: BLOCKED_LABEL})
        questions = {"operation": {"type": "choice", "criteria": operations, "instructions": {"goal": goal, "rules": NEXT_ACTION}}}
        for operation, candidates in targets.items():
            questions[operation.lower() + "_target"] = {
                "type": "choice",
                "criteria": {
                    index: {
                        "element": f"[{index}] {_short(a['label'])}",
                        "current_value": a.get("current_value", a.get("value", "")),
                        **{k: a[k] for k in ("role", "checked", "selected", "expanded") if k in a},
                    }
                    for index, a in candidates.items()
                },
                "instructions": {"goal": goal, "operation": operation, "rules": [NEXT_ACTION, TARGET]},
            }
        state = {
            "page": {k: self.page[k] for k in ("url", "title", "text")},
            "elements": _compact(elements),
            "recent_actions": [{k: h.get(k) for k in ("action", "kind", "text", "page_changed")} for h in history[-10:]],
        }
        return Pose(state=state, questions=questions)

    def act(self, decision: Decision, goal: str, history: list[dict], text: TextHelper) -> Outcome:
        assert self.browser is not None and self.page is not None
        operation = decision.choice("operation")
        if operation == DONE:
            return Outcome("done", {"action": DONE, "kind": "done"})
        if operation == BLOCKED:
            return Outcome("blocked", {"action": BLOCKED, "kind": "blocked"})
        if operation in self._targets:
            action = self._targets[operation][decision.choice(operation.lower() + "_target")]
        elif operation in self._controls:
            action = self._controls[operation]
        else:
            raise DecisionError(f"operation {operation} not offered")
        page, calls, value = self.page, [], None
        try:
            if action["kind"] == "fill":
                written = text.json(TEXT_VALUE, field_context(goal, action, page, history))
                calls.append({"latency_ms": written.latency_ms, "cost_usd": written.cost_usd})
                value = written.value.get("text")
                if not isinstance(value, str) or not value.strip():
                    return Outcome("blocked", {"action": action["label"], "kind": "fill", "error": "no field value"}, calls)
            self.browser.act(action, page, text=value)
        except StalePage:
            self.page = self.browser.observe(screenshot=False)
            return Outcome("continue", {"action": action["label"], "kind": action["kind"], "stale": True, "page_changed": True}, calls)
        except TextError as err:
            return Outcome("blocked", {"action": action["label"], "kind": "fill", "error": str(err)}, calls)
        self.page = self.browser.observe(screenshot=False)
        event = {
            "action": action["label"],
            "kind": action["kind"],
            "text": value,
            "page_changed": self.page["fingerprint"] != page["fingerprint"],
            "url": self.page["url"],
        }
        recent = [*history[-2:], event]
        stuck = len(recent) == 3 and all(h.get("page_changed") is False and h.get("kind") != "wait" for h in recent)
        return Outcome("blocked" if stuck else "continue", event, calls)

    def evidence(self, history: list[dict]) -> dict:
        page = self.page or {}
        return {"page": {k: page.get(k) for k in ("url", "title", "text")}, "recent_actions": history[-10:]}

    def close(self) -> None:
        if self.browser is not None:
            try:
                self.browser.close()
            finally:
                self.browser = None
