"""tomo-privacy personal-data gate: on the pack's personal sites, snapshots carry only headings and controls, values
read with browser_console wait for the student's approval, screenshots / raw CDP are refused, and a Hatch refusal
blocks reading. Driven without Hermes: a fake ctx answers `location.href`, next_call returns canned tool output."""
import json
import os

import importlib.util

HERE = os.path.dirname(__file__)
spec = importlib.util.spec_from_file_location("tomo_privacy_p", os.path.join(HERE, "..", "tomo-privacy", "__init__.py"),
                                              submodule_search_locations=[os.path.join(HERE, "..", "tomo-privacy")])
tp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tp)

PORTAL = "https://portal.example-u.ac.jp/campusweb/campussquare.do?_flowExecutionKey=e1s1"
OTHER = "https://www.example-u.ac.jp/news"
SNAPSHOT = "\n".join([
    '- heading "単位修得状況照会" [level=2]',
    '- table:',
    '  - row:',
    '    - cell "学生氏名"',
    '    - cell "Lin Mei"',
    '    - cell "累積GPA"',
    '    - cell "3.12"',
    '    - cell "情報リテラシー" [ref=e18]',
    '    - columnheader "評価" [ref=e11]',
    '- button "画面に表示する" [ref=e7]',
    '- link "ログアウト" [ref=e2]',
])


def payload(refused=False):
    return {
        "identifiers": [{"name": "FULL_NAME", "values": ["Lin Mei"], "kind": "name", "label": "name"}],
        "fill": {"tools": ["browser_type"], "origins": ["portal.example-u.ac.jp"]},
        "personal": {"origins": ["portal.example-u.ac.jp"], "refused": refused},
    }


class Ctx:
    def __init__(self, url):
        self.url = url

    def dispatch_tool(self, name, args, **_):
        assert name == "browser_console" and args == {"expression": "location.href"}
        return json.dumps({"success": True, "result": self.url})


def gate(url=PORTAL, refused=False, approve=True):
    asked = []

    def approve_fn(tool, message):
        asked.append(message)
        return approve, ""

    cb = tp.build(tp.Policy(payload(refused)), Ctx(url), approve_fn)
    return cb["tool_execution"], asked


def nav_result(url):
    return json.dumps({"success": True, "url": url, "title": "CampusSquare", "snapshot": SNAPSHOT})


def test_navigate_on_personal_site_keeps_only_headings_and_controls():
    run, asked = gate()
    out = json.loads(run("browser_navigate", {"url": PORTAL}, lambda a: nav_result(PORTAL)))
    assert "画面に表示する" in out["snapshot"] and "単位修得状況照会" in out["snapshot"]
    assert "3.12" not in out["snapshot"] and "情報リテラシー" not in out["snapshot"]
    assert "Lin Mei" not in json.dumps(out, ensure_ascii=False)
    assert "Do not ask for permission" in out["tomo_privacy"]
    assert asked == []  # structure only: nothing to approve


def test_navigate_elsewhere_is_untouched_but_masked():
    run, _ = gate(url=OTHER)
    out = json.loads(run("browser_navigate", {"url": OTHER}, lambda a: nav_result(OTHER)))
    assert "3.12" in out["snapshot"] and "{{FULL_NAME}}" in out["snapshot"] and "tomo_privacy" not in out


def test_snapshot_tool_uses_the_real_page_url():
    run, _ = gate()
    out = json.loads(run("browser_snapshot", {}, lambda a: json.dumps({"success": True, "snapshot": SNAPSHOT})))
    assert "3.12" not in out["snapshot"]


def test_console_read_waits_for_approval_and_shows_the_preview():
    run, asked = gate(approve=True)
    value = json.dumps({"累積GPA": "3.12", "name": "Lin Mei"}, ensure_ascii=False)
    out = run("browser_console", {"expression": "x"}, lambda a: json.dumps({"success": True, "result": value}, ensure_ascii=False))
    assert "3.12" in out and "Lin Mei" not in out
    assert len(asked) == 1
    desc = json.loads(asked[0].replace(tp.MARK, "", 1))
    assert desc["kind"] == "send" and desc["site"] == "portal.example-u.ac.jp"
    assert "3.12" in desc["preview"] and "{{FULL_NAME}}" in desc["preview"] and "Lin Mei" not in desc["preview"]


def test_console_read_refused_by_the_student_never_returns_the_value():
    run, asked = gate(approve=False)
    out = run("browser_console", {"expression": "x"}, lambda a: json.dumps({"success": True, "result": "3.12"}))
    assert "3.12" not in out and "did not allow" in out and len(asked) == 1


def test_console_elsewhere_needs_no_approval():
    run, asked = gate(url=OTHER)
    out = run("browser_console", {"expression": "x"}, lambda a: json.dumps({"success": True, "result": "hello"}))
    assert "hello" in out and asked == []


def test_hatch_refusal_reads_nothing():
    run, asked = gate(refused=True)
    ran = []
    out = run("browser_console", {"expression": "x"}, lambda a: ran.append(1) or json.dumps({"result": "3.12"}))
    assert ran == [] and "may not read" in out and asked == []
    nav = json.loads(run("browser_navigate", {"url": PORTAL}, lambda a: nav_result(PORTAL)))
    assert nav["snapshot"] == "" and "may not read" in nav["tomo_privacy"]


def test_screenshots_and_raw_cdp_are_refused_on_personal_sites():
    run, _ = gate()
    for tool in ("browser_vision", "browser_cdp"):
        ran = []
        out = run(tool, {}, lambda a: ran.append(1) or "{}")
        assert ran == [] and "not available on this site" in out
    run2, _ = gate(url=OTHER)
    assert run2("browser_vision", {}, lambda a: '{"ok": true}') == '{"ok": true}'


def test_structure_only_keeps_refs_and_headings():
    assert tp.structure_only(SNAPSHOT).splitlines() == [
        '- heading "単位修得状況照会" [level=2]', '    - columnheader "評価" [ref=e11]', '- button "画面に表示する" [ref=e7]',
        '- link "ログアウト" [ref=e2]']
