"""Tomo plugin for Hermes Agent: structured answer cards and the answer mode.

* `tomo_card(kind, title, data)` lets the model hand Tomo a card (course table, procedure steps, deadlines, sources,
  information chain). The window renders it from the `tool.start` arguments; the schema check below makes a
  malformed card fail loudly instead of rendering broken markup.
* The answer mode (direct answer / information chain, chosen by the study operator in Tomo) is read from
  `$HERMES_HOME/tomo/answer-mode.json` on every turn and injected through `pre_llm_call`.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

CARD_KINDS: dict[str, dict[str, Any]] = {
    "course_table": {"list": "rows", "required": ["title"], "fields": ["code", "title", "category", "credits", "time", "note"]},
    "steps": {"list": "steps", "required": ["title"], "fields": ["title", "detail"]},
    "deadlines": {"list": "items", "required": ["title", "date"], "fields": ["title", "date", "source"]},
    "sources": {"list": "items", "required": ["title"], "fields": ["title", "url", "code", "date", "page"]},
    "info_chain": {"list": "steps", "required": ["where", "how"], "fields": ["where", "how", "url"]},
}

SCHEMA = {
    "name": "tomo_card",
    "description": (
        "Show a structured card in Tomo's window next to your answer. Use it for course lists (course_table), "
        "procedures (steps), dates the student must meet (deadlines), the sources you used (sources) and, in "
        "information-chain mode, the path to the answer (info_chain). Write the card text in the student's language "
        "and keep official Japanese names as they are. Placeholders such as {{STUDENT_NUMBER}} stay as they are."
    ),
    "parameters": {
        "type": "object",
        "required": ["kind", "data"],
        "properties": {
            "kind": {"type": "string", "enum": list(CARD_KINDS)},
            "title": {"type": "string", "description": "Short card heading."},
            "data": {
                "type": "object",
                "description": (
                    "course_table: {rows: [{code, title, category, credits, time, note}]}; "
                    "steps: {steps: [{title, detail}]}; deadlines: {items: [{title, date (YYYY-MM-DD or text), source}]}; "
                    "sources: {items: [{title, url, code, date, page}]}; "
                    "info_chain: {steps: [{where, how, url}], last_step: what the student does themselves}"
                ),
            },
        },
    },
}

MODES = {
    "direct": (
        "Answer mode: direct answer. Give the answer itself, briefly, with its source (course code, page title, URL, "
        "date or term). Use tomo_card for course lists, procedures, deadlines and sources when it helps."
    ),
    "chain": (
        "Answer mode: information chain. Do NOT state the final answer itself. Show the student where the answer is "
        "and how to find it: which official page or document, which section, what to search or click, in order, "
        "with links. Call tomo_card with kind info_chain for the path and put the last step in `last_step` — the "
        "student does that step themselves. You may explain terms, but leave the final fact for the student to read."
    ),
}


def validate_card(kind: str, data: Any) -> str | None:
    spec = CARD_KINDS.get(kind)
    if spec is None:
        return f"unknown card kind {kind!r}; use one of {', '.join(CARD_KINDS)}"
    if not isinstance(data, dict):
        return "data must be an object"
    items = data.get(spec["list"])
    if not isinstance(items, list) or not items:
        return f"data.{spec['list']} must be a non-empty list"
    for i, item in enumerate(items):
        if not isinstance(item, dict):
            return f"data.{spec['list']}[{i}] must be an object"
        missing = [f for f in spec["required"] if not str(item.get(f) or "").strip()]
        if missing:
            return f"data.{spec['list']}[{i}] needs {', '.join(missing)}"
    return None


def tomo_card(args: dict[str, Any], **_: Any) -> str:
    kind = str(args.get("kind") or "")
    problem = validate_card(kind, args.get("data"))
    if problem:
        return json.dumps({"error": f"tomo_card: {problem}"})
    return json.dumps({"ok": True, "shown": kind})


def mode_file() -> Path:
    return Path(os.environ.get("HERMES_HOME", ".")) / "tomo" / "answer-mode.json"


def current_mode() -> str:
    try:
        mode = json.loads(mode_file().read_text(encoding="utf-8")).get("mode")
    except (OSError, ValueError):
        mode = None
    return mode if mode in MODES else "direct"


def pre_llm_call(**_: Any) -> dict[str, str]:
    return {"context": MODES[current_mode()]}


def register(ctx: Any) -> None:
    ctx.register_tool("tomo_card", "tomo", SCHEMA, tomo_card, description=SCHEMA["description"], emoji="🗂")
    ctx.register_hook("pre_llm_call", pre_llm_call)
