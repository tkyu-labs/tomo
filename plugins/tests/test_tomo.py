import importlib.util
import json
import os

_dir = os.path.join(os.path.dirname(__file__), "..", "tomo")
spec = importlib.util.spec_from_file_location("tomo_plugin", os.path.join(_dir, "__init__.py"), submodule_search_locations=[_dir])
tomo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tomo)


def test_card_validation():
    ok = tomo.tomo_card({"kind": "course_table", "data": {"rows": [{"code": "B31L01", "title": "Database"}]}})
    assert json.loads(ok) == {"ok": True, "shown": "course_table"}
    assert "unknown card kind" in tomo.tomo_card({"kind": "poster", "data": {}})
    assert "needs where, how" in tomo.tomo_card({"kind": "info_chain", "data": {"steps": [{}]}})
    assert "non-empty list" in tomo.tomo_card({"kind": "sources", "data": {"items": []}})


def test_answer_mode_from_file(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    assert "direct answer" in tomo.pre_llm_call()["context"]
    (tmp_path / "tomo").mkdir()
    (tmp_path / "tomo" / "answer-mode.json").write_text('{"mode": "chain"}')
    assert "information chain" in tomo.pre_llm_call()["context"]
    (tmp_path / "tomo" / "answer-mode.json").write_text('{"mode": "nonsense"}')
    assert "direct answer" in tomo.pre_llm_call()["context"]
