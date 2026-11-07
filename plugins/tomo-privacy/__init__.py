"""Tomo privacy plugin for Hermes Agent (non-compat plugin API, Hermes v0.21.x).

Real identifier values never enter Hermes' context: Tomo masks the user's input before `prompt.submit`, and this
plugin masks everything that comes back from tools, plus a safety net on every outgoing model request. The values
arrive once, in the TOMO_PRIVATE environment variable, which is removed from os.environ as soon as the plugin
loads so no child process can inherit it.

Filling a value into a page (e.g. the student number into a form) works by placeholder: the model calls
`browser_type(ref, "{{STUDENT_NUMBER}}")`; the `tool_execution` middleware checks the tool and the page's origin
against the allow-list (the school's own pages; trusted, so no question), and only then substitutes the real value;
the result is masked again. Passwords are never handled.

Personal data (grades, GPA, self-check, timetable) lives on the pack's `personal_origins` (e.g. the CampusSquare
portal). Reading it is gated here too, so it never depends on the model asking first:
- page snapshots from those sites (browser_navigate's auto-snapshot, browser_snapshot) keep only headings and
  controls (what the model needs to sign in, set filters and press buttons), never the data on the page;
- values are read with browser_console extractions. The student decides once (students are not IT people: no
  approval per item): in the Hatch (pack `personal_consent`), or, when that was never asked, the first time a value
  is read (an `approval` request of kind "consent"; Tomo remembers the answer). Allowed: results pass and carry a
  marker so Tomo can say in the chat which site's data was used. Refused: nothing is read at all;
- screenshots (browser_vision) and raw DevTools (browser_cdp) are refused there: the content is not readable text.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any
from urllib.parse import urlsplit

try:  # loaded as a Hermes plugin package
    from .masking import Masker, load_payload
except ImportError:  # pragma: no cover - direct import in tests
    from masking import Masker, load_payload  # type: ignore

logger = logging.getLogger(__name__)

ENV_NAME = "TOMO_PRIVATE"
MARK = "[tomo-privacy]"
BROWSER_TOOLS = {"browser_type", "browser_fill", "browser_press"}
# Never available in Tomo: password managers / login vault (Tomo never handles passwords), Browser Use's free-form
# Python (arguments cannot be inspected) and code execution (Hermes issue #139062).
BLOCKED_TOOLS = {"browser_exec", "execute_code"}
BLOCKED_PREFIXES = ("browser_vault_",)
# Tools whose result carries page content, and tools whose content cannot be previewed (never on personal sites).
SNAPSHOT_TOOLS = {"browser_navigate", "browser_snapshot"}
READ_TOOLS = {"browser_console", "browser_get_images"}
OPAQUE_TOOLS = {"browser_vision", "browser_cdp"}
# Snapshot lines kept on personal sites, by role: headings and table headers (labels, not values) and the controls
# the model needs. Every other line (cells, text, paragraphs) is dropped, even when it has a ref.
_CONTROL_ROLES = ("heading", "columnheader", "rowheader", "button", "link", "textbox", "searchbox", "combobox",
                  "listbox", "option", "checkbox", "radio", "tab", "menuitem", "spinbutton", "switch", "form",
                  "navigation")
# Marks a tool result that carries personal data (Tomo shows "used your data from <site>" under the answer).
PERSONAL_MARK = f"{MARK} personal data read on "


def structure_only(snapshot: str) -> str:
    """A compact accessibility snapshot reduced to headings and controls (no cell or paragraph text)."""
    kept = []
    for line in snapshot.splitlines():
        body = line.strip().lstrip("- ").strip()
        role = body.split(" ", 1)[0].rstrip(":")
        if role in _CONTROL_ROLES:
            kept.append(line)
    return "\n".join(kept)


class Policy:
    def __init__(self, payload: dict[str, Any]):
        self.masker = Masker.from_payload(payload)
        fill = payload.get("fill") or {}
        self.fill_tools: set[str] = set(fill.get("tools") or [])
        self.fill_origins: list[str] = [o.lower() for o in fill.get("origins") or []]
        self.labels: dict[str, str] = {i["name"]: i.get("label") or i["name"] for i in payload.get("identifiers", [])}
        personal = payload.get("personal") or {}
        self.personal_origins: list[str] = [o.lower() for o in personal.get("origins") or []]
        # "granted" / "refused" (decided once, in the Hatch or the first time), "ask": not decided yet
        consent = personal.get("consent") or ("refused" if personal.get("refused") else "ask")
        self.personal_consent: str = consent if consent in ("granted", "refused", "ask") else "ask"

    @staticmethod
    def _host_in(url: str | None, origins: list[str]) -> bool:
        host = (urlsplit(url or "").hostname or "").lower()
        return bool(host) and any(host == o or host.endswith("." + o) for o in origins)

    def origin_allowed(self, url: str | None) -> bool:
        if "*" in self.fill_origins:
            return True
        return self._host_in(url, self.fill_origins)

    def personal(self, url: str | None) -> bool:
        return self._host_in(url, self.personal_origins)


def _current_url(ctx: Any, task_id: str | None) -> str | None:
    """The page the agent's browser is on right now (not what the model claims)."""
    try:
        raw = ctx.dispatch_tool("browser_console", {"expression": "location.href"}, task_id=task_id)
        data = json.loads(raw) if isinstance(raw, str) else raw
        value = data.get("result") if isinstance(data, dict) else None
        if isinstance(value, dict):
            value = value.get("value")
        return str(value).strip('"') if value else None
    except Exception:  # pragma: no cover - depends on a live browser
        logger.debug("tomo-privacy: could not read the current page URL", exc_info=True)
        return None


def build(policy: Policy, ctx: Any = None, approve_fn=None) -> dict[str, Any]:
    """Callbacks bound to one policy (separate from register() so tests can drive them directly)."""
    masker = policy.masker

    def wants_fill(tool_name: str, args: Any) -> set[str]:
        if tool_name not in policy.fill_tools:
            return set()
        return {n for n in masker.placeholders_in(args) if masker.value_of(n)}

    def target_allowed(tool_name: str, task_id: str | None) -> tuple[bool, str]:
        if tool_name in BROWSER_TOOLS:
            url = _current_url(ctx, task_id) if ctx is not None else None
            return policy.origin_allowed(url), (urlsplit(url or "").hostname or "an unknown page")
        return policy.origin_allowed("*") if "*" in policy.fill_origins else False, tool_name

    def ask(tool_name: str, message: str) -> tuple[bool, str]:
        """Hermes' own human-approval gate (the one `pre_tool_call` → {"action": "approve"} uses,
        hermes_cli/plugins.py:_resolve_block_from_details). Reaches Tomo as an `approval` server request."""
        if approve_fn is not None:
            return approve_fn(tool_name, message)
        from tools.approval import request_tool_approval  # Hermes, imported lazily

        result = request_tool_approval(tool_name, message, rule_key=f"tomo-privacy:{tool_name}:{message}")
        return bool(result.get("approved")), str(result.get("message") or "")

    def page_url(task_id: str | None) -> str | None:
        return _current_url(ctx, task_id) if ctx is not None else None

    refused_note = (f"{MARK} The student chose that Tomo may not read their grades or other personal data. Do not "
                    "read this page; tell the student where the information is and let them look.")

    def personal_snapshot(tool_name: str, args: Any, next_call, task_id: str | None):
        """navigate / snapshot: on a personal site, pass only headings and controls."""
        raw = next_call(args)
        try:
            data = json.loads(raw) if isinstance(raw, str) else raw
        except (TypeError, ValueError):
            return masker.mask_any(raw)
        if not isinstance(data, dict):
            return masker.mask_any(raw)
        url = data.get("url") if tool_name == "browser_navigate" else page_url(task_id)
        if not policy.personal(url) or not isinstance(data.get("snapshot"), str):
            return masker.mask_any(raw)
        if policy.personal_consent == "refused":
            data["snapshot"] = ""
            data["tomo_privacy"] = refused_note
        else:
            data["snapshot"] = structure_only(data["snapshot"])
            data["tomo_privacy"] = (f"{MARK} This page holds the student's personal data: the snapshot shows only "
                                    "headings and controls. Read the values the question needs with browser_console "
                                    "(the pack skill's extraction). Do not ask for permission yourself; Tomo handles it.")
        return masker.mask_any(json.dumps(data, ensure_ascii=False))

    def personal_read(tool_name: str, args: Any, next_call, task_id: str | None):
        """console / images: on a personal site, read only with the student's one-time consent."""
        url = page_url(task_id)
        if not policy.personal(url):
            return masker.mask_any(next_call(args))
        host = (urlsplit(url or "").hostname or "")
        if policy.personal_consent == "ask":
            # once: Tomo stores the answer, so the next engine start knows it too
            approved, _why = ask(tool_name, f"{MARK} " + json.dumps({"kind": "consent", "site": host}, ensure_ascii=False))
            policy.personal_consent = "granted" if approved else "refused"
        if policy.personal_consent == "refused":
            return json.dumps({"error": refused_note})
        result = masker.mask_any(next_call(args))
        # the marker tells Tomo (tool.complete) which site's personal data this answer used
        text = result if isinstance(result, str) else json.dumps(result, ensure_ascii=False)
        try:
            data = json.loads(text)
        except (TypeError, ValueError):
            return result
        if isinstance(data, dict):
            data["tomo_privacy"] = f"{PERSONAL_MARK}{host}"
            return json.dumps(data, ensure_ascii=False)
        return result

    def tool_execution(tool_name: str = "", args: Any = None, next_call=None, task_id: str | None = None, **_: Any):
        # Runs around the whole tool call, before Hermes' pre_tool_call hooks and before tool.start is emitted with
        # the effective args — so the decision and the substitution both happen here (model_tools.py:839-844).
        if tool_name in BLOCKED_TOOLS or tool_name.startswith(BLOCKED_PREFIXES):
            return json.dumps({"error": f"{MARK} {tool_name} is not available in Tomo. Ask the student to do this step themselves."})
        if policy.personal_origins:
            if tool_name in OPAQUE_TOOLS and policy.personal(page_url(task_id)):
                return json.dumps({"error": f"{MARK} {tool_name} is not available on this site (the student's personal "
                                            "data cannot be shown to them first). Use browser_console with the skill's extraction."})
            if tool_name in SNAPSHOT_TOOLS:
                return personal_snapshot(tool_name, args or {}, next_call, task_id)
            if tool_name in READ_TOOLS:
                return personal_read(tool_name, args or {}, next_call, task_id)
        names = wants_fill(tool_name, args or {})
        if not names:
            return masker.mask_any(next_call(args))
        what = ", ".join(policy.labels.get(n, n) for n in sorted(names))
        ok, where = target_allowed(tool_name, task_id)
        if not ok:
            return json.dumps({"error": f"{MARK} {what} may only be filled in on the school's own pages; {where} is not one of them."})
        # the school's own pages are trusted: filled in without a question (the model still only sees the placeholder)
        return masker.mask_any(next_call(masker.substitute(args)))

    def transform_tool_result(result: Any = None, **_: Any):
        if isinstance(result, str):
            masked = masker.mask(result)
            return masked if masked != result else None
        return None

    def transform_terminal_output(output: Any = None, **_: Any):
        if isinstance(output, str):
            masked = masker.mask(output)
            return masked if masked != output else None
        return None

    def llm_request(request: Any = None, **_: Any):
        if not isinstance(request, dict):
            return None
        changed = {}
        for key in ("messages", "input", "system", "instructions"):
            if key in request:
                masked = masker.mask_any(request[key])
                if masked != request[key]:
                    changed[key] = masked
        if not changed:
            return None
        return {"request": {**request, **changed}, "source": "tomo-privacy", "reason": "mask identifiers"}

    return {
        "tool_execution": tool_execution,
        "transform_tool_result": transform_tool_result,
        "transform_terminal_output": transform_terminal_output,
        "llm_request": llm_request,
    }


def register(ctx: Any) -> None:
    # Read once and remove, so terminal children and any later subprocess never inherit the values.
    payload = load_payload(os.environ.pop(ENV_NAME, None))
    policy = Policy(payload)
    cb = build(policy, ctx)
    ctx.register_hook("transform_tool_result", cb["transform_tool_result"])
    ctx.register_hook("transform_terminal_output", cb["transform_terminal_output"])
    ctx.register_middleware("tool_execution", cb["tool_execution"])
    ctx.register_middleware("llm_request", cb["llm_request"])
    logger.info("tomo-privacy: %d identifier(s), fill tools %s", len(policy.masker.identifiers), sorted(policy.fill_tools))
