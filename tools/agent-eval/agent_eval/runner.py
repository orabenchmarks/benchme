"""agent-eval — the three pairs: {browser, WebMCP, NLWeb} × {jev, LLM} decider.

    uv run agent-eval --protocols browser,webmcp,nlweb --deciders jev,claude-haiku-4-5-20251001 \\
        --repeats 3 --out results/agent-eval

Env: BENCHME_BASE (gateway reachable from here, default http://localhost:8090),
JEV_BASE_URL + JEV_API_KEY, LLM_BASE_URL + LLM_API_KEY (Anthropic-compatible),
TEXT_MODEL (the writer on BOTH sides, default claude-haiku-4-5-20251001),
BU_CDP_URL (the Chromium the browser/WebMCP spaces drive).

Each run gets a FRESH workspace (writes must not leak between runs) and a
signed-in session for its task's app. Writes <out>.jsonl (one run per line,
full history) as it goes, then <out>.md (the summary).
"""

from __future__ import annotations

import argparse
import json
import os
from collections.abc import Callable
from pathlib import Path

from .deciders import Decider, JevDecider, LlmDecider
from .loop import run_task
from .report import render
from .spaces.base import ActionSpace, Target
from .spaces.browser import BrowserSpace
from .spaces.nlweb import NlwebSpace
from .spaces.webmcp import WebMcpSpace
from .tasks import load_tasks
from .text import TextHelper
from .workspace import mint, sign_in

#: Per-MTok USD (input, output) for the Anthropic models this tool runs.
LLM_PRICES = {"claude-haiku-4-5-20251001": (1.0, 5.0), "claude-sonnet-5": (3.0, 15.0)}


def make_decider(name: str) -> Decider:
    if name == "jev":
        return JevDecider(os.environ.get("JEV_BASE_URL", "https://api.typesafe.ai"), os.environ["JEV_API_KEY"])
    if name in LLM_PRICES:
        return LlmDecider(os.environ.get("LLM_BASE_URL", "https://api.anthropic.com"), os.environ["LLM_API_KEY"], name, LLM_PRICES[name])
    raise SystemExit(f"unknown decider {name} (jev | {' | '.join(LLM_PRICES)})")


def ranker_for(decider: str) -> str:
    """NLWeb's site-side ranker follows the arm: jev ranks for jev, the LLM ranker otherwise."""
    return "jev" if decider == "jev" else "llm"


#: Registry: protocol → a factory for a fresh space, given the arm's decider name.
SPACES: dict[str, Callable[[str], ActionSpace]] = {
    "browser": lambda _decider: BrowserSpace(),
    "webmcp": lambda _decider: WebMcpSpace(),
    "nlweb": lambda decider: NlwebSpace(ranker_for(decider)),
}


def main() -> None:
    parser = argparse.ArgumentParser(prog="agent-eval")
    parser.add_argument("--protocols", default="browser,webmcp,nlweb")
    parser.add_argument("--deciders", default="jev,claude-haiku-4-5-20251001")
    parser.add_argument("--tasks", default="", help="comma-separated task ids (default: all)")
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--seed", type=int, default=4242)
    parser.add_argument("--scenario", default="acme-v1")
    parser.add_argument("--max-steps", type=int, default=30)
    parser.add_argument("--max-seconds", type=float, default=240)
    parser.add_argument("--out", default="agent-eval")
    args = parser.parse_args()

    base = os.environ.get("BENCHME_BASE", "http://localhost:8090").rstrip("/")
    text_model = os.environ.get("TEXT_MODEL", "claude-haiku-4-5-20251001")
    text = TextHelper(os.environ.get("LLM_BASE_URL", "https://api.anthropic.com"), os.environ["LLM_API_KEY"], text_model, LLM_PRICES[text_model])
    deciders = {name: make_decider(name) for name in args.deciders.split(",")}
    wanted = set(filter(None, args.tasks.split(",")))
    tasks = [t for t in load_tasks() if not wanted or t.id in wanted]
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    runs_path = out.with_suffix(".jsonl")

    with runs_path.open("a") as sink:
        for repeat in range(args.repeats):
            for task in tasks:
                for protocol in args.protocols.split(","):
                    for name, decider in deciders.items():
                        space = SPACES[protocol](name)
                        if space.surface not in task.surfaces:
                            continue
                        workspace = mint(base, args.scenario, args.seed, os.environ.get("BENCHME_OPERATOR_KEY"))
                        cookies = sign_in(base, workspace, task.app) if protocol != "nlweb" else []
                        target = Target(base, workspace, task.app, cookies)
                        result = run_task(space, decider, text, task, target, repeat, args.max_steps, args.max_seconds)
                        sink.write(json.dumps(result.to_json()) + "\n")
                        sink.flush()
                        print(f"{protocol:8} {name:28} {task.id:20} r{repeat} {result.verdict:5} {result.end:11} "
                              f"steps={result.steps:2} wall={result.wall_ms / 1000:6.1f}s cost=${result.cost_usd:.4f}"
                              + (f"  {result.error}" if result.error else ""), flush=True)

    runs = [json.loads(line) for line in runs_path.read_text().splitlines() if line.strip()]
    out.with_suffix(".md").write_text(render(runs, text_model))
    print(f"wrote {runs_path} and {out.with_suffix('.md')}")


if __name__ == "__main__":
    main()
