"""The benchme intent tasks, their oracles, and the verdict.

Tasks and oracles come from `compose/specs/` (the same files the verifier
serves), never restated here. The verdict is the VERIFIER's: a `json` task
submits the final answer; a `state` task submits an empty artifact and the
verifier reads the workspace's live app state.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import httpx

SPECS = Path(__file__).resolve().parents[3] / "compose" / "specs"


@dataclass(frozen=True)
class Task:
    id: str
    app: str
    intent: str
    oracle: str  # "json" | "state"
    answer_keys: tuple[str, ...]  # for "json": the keys the verifier checks
    surfaces: tuple[str, ...]  # which doors can answer it: "pages" | "tools" | "nlweb"


def load_tasks(specs: Path = SPECS) -> list[Task]:
    tasks = []
    for entry in json.loads((specs / "intent-tasks.json").read_text()):
        spec = json.loads((specs / f"{entry['id']}.json").read_text())
        oracle = spec["oracle"]
        keys = tuple(oracle.get("expect", {})) if oracle["kind"] == "json" else ()
        surfaces = tuple(entry.get("surfaces") or ("pages", "tools"))
        tasks.append(Task(entry["id"], entry["app"], entry["intent"], oracle["kind"], keys, surfaces))
    return tasks


def verify(base: str, workspace: str, task: Task, answer: dict | None) -> dict:
    """POST the artifact to the workspace's verifier; returns {verdict, details}."""
    artifact = json.dumps(answer or {}) if task.oracle == "json" else "{}"
    response = httpx.post(
        f"{base}/w/{workspace}/verify/v1/submit/{task.id}",
        content=artifact,
        headers={"content-type": "application/json"},
        timeout=60,
    )
    body = response.json()
    if "verdict" not in body:
        raise RuntimeError(f"verifier answered {response.status_code}: {body}")
    return {"verdict": body["verdict"], "details": body.get("details", [])}
