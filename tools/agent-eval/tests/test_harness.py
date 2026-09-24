"""Offline tests: nothing here calls a model, a browser or the gateway."""

from agent_eval.deciders import Decision, DecisionError, _first_json, _validate
from agent_eval.report import _cell, render
from agent_eval.spaces.nlweb import _id
from agent_eval.tasks import load_tasks

QUESTIONS = {
    "operation": {"type": "choice", "criteria": {"CLICK": "x", "DONE": "y"}, "instructions": {}},
    "click_target": {"type": "choice", "criteria": {"1": "a", "2": "b"}, "instructions": {}},
}


def test_validate_keeps_only_offered_choices():
    answers = {"operation": {"choice": "CLICK", "confidence": 0.9}, "click_target": {"choice": "7", "confidence": 0.8}}
    kept = _validate(answers, QUESTIONS)
    assert kept == {"operation": {"choice": "CLICK", "confidence": 0.9}}


def test_validate_reads_confidence_from_probabilities_when_absent():
    kept = _validate({"operation": {"choice": "DONE", "probabilities": {"DONE": 0.7, "CLICK": 0.3}}}, QUESTIONS)
    assert kept["operation"]["confidence"] == 0.7


def test_an_unanswered_question_is_a_decision_error_not_a_guess():
    decision = Decision(answers={}, model="m", latency_ms=1)
    try:
        decision.choice("operation")
    except DecisionError:
        return
    raise AssertionError("expected DecisionError")


def test_first_json_survives_prose_around_the_object():
    assert _first_json('Sure! {"operation": {"choice": "DONE"}} hope that helps') == {"operation": {"choice": "DONE"}}
    assert _first_json("no json here") is None


def test_nlweb_record_id_is_the_last_url_segment():
    assert _id({"url": "/w/ws_1/warehouse/customers/C-114"}) == "C-114"
    assert _id({"url": "/w/ws_1/vaultdocs/documents/doc-137/"}) == "doc-137"


def test_every_task_declares_its_surfaces_and_answer_keys():
    tasks = load_tasks()
    assert len(tasks) == 10
    for t in tasks:
        assert set(t.surfaces) <= {"pages", "tools", "nlweb"} and "pages" in t.surfaces
        assert (t.oracle == "json") == bool(t.answer_keys)
        if "nlweb" in t.surfaces:
            assert t.oracle == "json"  # NLWeb is retrieval only


def _run(verdict, wall_ms=1000, **extra):
    base = {"protocol": "browser", "decider": "jev", "task": "t", "verdict": verdict, "wall_ms": wall_ms, "steps": 3,
            "decisions": 3, "decision_ms": 300, "cost_usd": 0.01, "decision_cost_usd": 0.001, "ranker_cost_usd": 0.0,
            "invalid_decisions": 0}
    return {**base, **extra}


def test_errors_are_counted_but_never_folded_into_success():
    cell = _cell([_run("OK"), _run("FAIL"), _run("ERROR")])
    assert cell["errors"] == 1
    assert cell["success"] == 0.5


def test_render_lists_each_protocol_decider_cell():
    md = render([_run("OK"), _run("FAIL", decider="claude-haiku-4-5-20251001")], "claude-haiku-4-5-20251001")
    assert "| browser | jev |" in md and "| browser | claude-haiku-4-5-20251001 |" in md
