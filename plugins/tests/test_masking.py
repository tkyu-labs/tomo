import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tomo-privacy"))

from masking import Masker  # noqa: E402

import importlib.util  # noqa: E402

spec = importlib.util.spec_from_file_location("tomo_privacy", os.path.join(os.path.dirname(__file__), "..", "tomo-privacy", "__init__.py"),
                                              submodule_search_locations=[os.path.join(os.path.dirname(__file__), "..", "tomo-privacy")])
tomo_privacy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tomo_privacy)

PAYLOAD = {
    "identifiers": [
        {"name": "STUDENT_NUMBER", "values": ["23B0001"], "kind": "id", "label": "student number"},
        {"name": "FULL_NAME", "values": ["Lin Mei", "林 美", "リン メイ"], "kind": "name", "label": "name"},
    ],
    "fill": {"tools": ["browser_type", "write_file"], "origins": ["portal.example-school.ac.jp"]},
}
M = Masker.from_payload(PAYLOAD)


def test_student_number_variants():
    assert M.mask("my number is 23B0001.") == "my number is {{STUDENT_NUMBER}}."
    assert M.mask("23b0001") == "{{STUDENT_NUMBER}}"
    assert M.mask("２３Ｂ０００１です") == "{{STUDENT_NUMBER}}です"
    assert M.mask("23B00011") == "23B00011"  # longer token is a different number


def test_name_spacing():
    assert M.mask("I am Lin Mei") == "I am {{FULL_NAME}}"
    assert M.mask("LinMei and lin  mei") == "{{FULL_NAME}} and {{FULL_NAME}}"
    assert M.mask("林美です、林　美") == "{{FULL_NAME}}です、{{FULL_NAME}}"
    assert M.mask("リンメイ") == "{{FULL_NAME}}"


def test_mask_any_and_substitute():
    data = {"messages": [{"role": "user", "content": "Lin Mei 23B0001"}]}
    assert M.mask_any(data) == {"messages": [{"role": "user", "content": "{{FULL_NAME}} {{STUDENT_NUMBER}}"}]}
    assert M.substitute({"text": "{{STUDENT_NUMBER}} {{UNKNOWN}}"}) == {"text": "23B0001 {{UNKNOWN}}"}
    assert M.placeholders_in(["{{FULL_NAME}}", {"a": "{{STUDENT_NUMBER}}"}]) == {"FULL_NAME", "STUDENT_NUMBER"}


def test_fill_needs_an_allowed_tool_and_origin():
    asked = []
    cb = tomo_privacy.build(tomo_privacy.Policy(PAYLOAD), approve_fn=lambda t, m: (asked.append(m) or True, ""))
    seen = {}
    # not a fill tool: placeholder passes through untouched
    cb["tool_execution"](tool_name="terminal", args={"command": "echo {{STUDENT_NUMBER}}"},
                         next_call=lambda a: seen.setdefault("t", a) and "ok")
    assert seen["t"]["command"] == "echo {{STUDENT_NUMBER}}" and asked == []
    # fill tool, but its "origin" is not allowed (no "*") → refused without running the tool
    out = cb["tool_execution"](tool_name="write_file", args={"content": "{{STUDENT_NUMBER}}"},
                               next_call=lambda a: pytest.fail("must not run"))
    assert "may only be filled in" in out and asked == []


def test_fill_on_an_allowed_origin_substitutes_without_a_question_and_remasks():
    payload = {**PAYLOAD, "fill": {"tools": ["write_file"], "origins": ["*"]}}
    asked = []
    cb = tomo_privacy.build(tomo_privacy.Policy(payload), approve_fn=lambda t, m: (asked.append(m) or True, ""))
    seen = {}

    def run(a):
        seen["args"] = a
        return '{"written": "23B0001"}'

    out = cb["tool_execution"](tool_name="write_file", args={"content": "{{STUDENT_NUMBER}}"}, next_call=run)
    assert out == '{"written": "{{STUDENT_NUMBER}}"}'
    assert seen["args"]["content"] == "23B0001"
    assert asked == []  # the school's own pages are trusted


def test_llm_request_safety_net():
    cb = tomo_privacy.build(tomo_privacy.Policy(PAYLOAD))
    req = {"model": "m", "messages": [{"role": "tool", "content": "Name: Lin Mei"}]}
    out = cb["llm_request"](request=req)
    assert out["request"]["messages"][0]["content"] == "Name: {{FULL_NAME}}"
    assert cb["llm_request"](request={"model": "m", "messages": [{"role": "user", "content": "hi"}]}) is None


def test_register_pops_env(monkeypatch):
    import json
    monkeypatch.setenv("TOMO_PRIVATE", json.dumps(PAYLOAD))
    calls = []

    class Ctx:
        def register_hook(self, name, fn): calls.append(name)
        def register_middleware(self, kind, fn): calls.append(kind)

    tomo_privacy.register(Ctx())
    assert "TOMO_PRIVATE" not in os.environ
    assert {"tool_execution", "llm_request", "transform_tool_result"} <= set(calls)


def test_shared_cases_match_typescript():
    import json
    path = os.path.join(os.path.dirname(__file__), "..", "..", "test", "fixtures", "masking-cases.json")
    data = json.load(open(path, encoding="utf-8"))
    m = Masker.from_payload(data["payload"])
    for given, expected in data["cases"]:
        assert m.mask(given) == expected, given


def test_vault_and_code_tools_are_blocked():
    cb = tomo_privacy.build(tomo_privacy.Policy(PAYLOAD))
    for name in ("browser_vault_fill", "browser_vault_save_login", "execute_code", "browser_exec"):
        out = cb["tool_execution"](tool_name=name, args={}, next_call=lambda a: pytest.fail("must not run"))
        assert "not available in Tomo" in out
