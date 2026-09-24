"""agent-eval's summary: per (protocol, decider) and the jev-vs-LLM pair per protocol.

Only numbers computed from the run rows; an ERROR run (the harness or the
site failed, not the decider) is counted and shown, never folded into the
success rate silently.
"""

from __future__ import annotations

from collections import defaultdict
from statistics import median


def _cell(rows: list[dict]) -> dict:
    judged = [r for r in rows if r["verdict"] in {"OK", "FAIL"}]
    ok = [r for r in judged if r["verdict"] == "OK"]
    return {
        "runs": len(rows),
        "errors": len(rows) - len(judged),
        "success": (len(ok) / len(judged)) if judged else None,
        "median_s": median(r["wall_ms"] for r in judged) / 1000 if judged else None,
        "median_s_ok": median(r["wall_ms"] for r in ok) / 1000 if ok else None,
        "median_steps": median(r["steps"] for r in judged) if judged else None,
        "decision_ms_per_step": (sum(r["decision_ms"] for r in judged) / max(1, sum(r["decisions"] for r in judged))) if judged else None,
        "usd_per_run": (sum(r["cost_usd"] for r in judged) / len(judged)) if judged else None,
        "decision_usd_per_run": (sum(r["decision_cost_usd"] + r["ranker_cost_usd"] for r in judged) / len(judged)) if judged else None,
        "invalid": sum(r["invalid_decisions"] for r in rows),
    }


def _fmt(v, kind="") -> str:
    if v is None:
        return "—"
    if kind == "pct":
        return f"{v * 100:.0f}%"
    if kind == "s":
        return f"{v:.1f} s"
    if kind == "usd":
        return f"${v:.4f}"
    if kind == "ms":
        return f"{v:.0f} ms"
    return f"{v:g}" if isinstance(v, (int, float)) else str(v)


def render(runs: list[dict], text_model: str) -> str:
    by = defaultdict(list)
    for r in runs:
        by[(r["protocol"], r["decider"])].append(r)
    protocols = sorted({p for p, _ in by}, key=["browser", "webmcp", "nlweb"].index)
    deciders = sorted({d for _, d in by}, key=lambda d: (d != "jev", d))
    lines = [
        "# agent-eval — jev vs an LLM deciding, per protocol",
        "",
        f"{len(runs)} runs. The writer (field values, tool arguments, queries, final answers) is `{text_model}` on both sides.",
        "Success = the benchme verifier's verdict (live app state for writes, the exact answer for reads).",
        "",
        "| protocol | decider | runs | errors | success | median time | median time (successes) | median steps | decision latency / step | $ / run | decision $ / run | invalid answers |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    cells = {key: _cell(rows) for key, rows in by.items()}
    for p in protocols:
        for d in deciders:
            c = cells.get((p, d))
            if not c:
                continue
            lines.append(
                f"| {p} | {d} | {c['runs']} | {c['errors']} | {_fmt(c['success'], 'pct')} | {_fmt(c['median_s'], 's')} | "
                f"{_fmt(c['median_s_ok'], 's')} | {_fmt(c['median_steps'])} | {_fmt(c['decision_ms_per_step'], 'ms')} | "
                f"{_fmt(c['usd_per_run'], 'usd')} | {_fmt(c['decision_usd_per_run'], 'usd')} | {c['invalid']} |"
            )
    lines += ["", "## Per task", "", "| task | protocol | " + " | ".join(deciders) + " |", "| --- | --- | " + " | ".join("---" for _ in deciders) + " |"]
    tasks = sorted({r["task"] for r in runs})
    for t in tasks:
        for p in protocols:
            row = []
            for d in deciders:
                rs = [r for r in by.get((p, d), []) if r["task"] == t]
                if not rs:
                    row.append("n/a")
                    continue
                ok = sum(r["verdict"] == "OK" for r in rs)
                med = median(r["wall_ms"] for r in rs) / 1000
                row.append(f"{ok}/{len(rs)} · {med:.1f} s")
            if any(x != "n/a" for x in row):
                lines.append(f"| {t} | {p} | " + " | ".join(row) + " |")
    return "\n".join(lines) + "\n"
