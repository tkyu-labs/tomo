"""Identifier masking for Tomo: real values ⇄ {{PLACEHOLDER}} by plain full-text matching.

Matching is deliberately simple and predictable (decisions: pack-format § 5): every stored value and alias is
matched literally, with these tolerances only:
  * Unicode NFKC on both sides' ASCII forms: full-width letters/digits (２３Ｂ０００１) match their ASCII value;
  * identifiers (kind "id") match case-insensitively;
  * names (kind "name") match with any (or no) whitespace, including the ideographic space, between their parts.
Longer values win over shorter ones, so a full name is replaced before one of its parts.
"""

from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass, field
from typing import Any, Iterable

PLACEHOLDER_RE = re.compile(r"\{\{([A-Z][A-Z0-9_]*)\}\}")
_SPACE = r"[\s　]*"


def _fullwidth(text: str) -> str:
    """ASCII letters/digits → their full-width forms (the inverse of what NFKC folds)."""
    out = []
    for ch in text:
        code = ord(ch)
        out.append(chr(code + 0xFEE0) if 0x21 <= code <= 0x7E and ch.isalnum() else ch)
    return "".join(out)


def _char_class(ch: str) -> str:
    """Pattern for one character that also accepts its full-width / NFKC variants."""
    variants = {ch, unicodedata.normalize("NFKC", ch), _fullwidth(ch)}
    if len(variants) == 1:
        return re.escape(ch)
    return "(?:" + "|".join(re.escape(v) for v in sorted(variants, key=len, reverse=True)) + ")"


@dataclass
class Identifier:
    name: str  # placeholder variable, e.g. STUDENT_NUMBER
    values: list[str]
    kind: str = "id"  # "id" | "name"


@dataclass
class Masker:
    identifiers: list[Identifier] = field(default_factory=list)

    def __post_init__(self) -> None:
        self._patterns: list[tuple[re.Pattern[str], str]] = []
        entries: list[tuple[str, Identifier]] = []
        for ident in self.identifiers:
            for value in ident.values:
                value = unicodedata.normalize("NFKC", value or "").strip()
                if len(value) >= 2:  # a single character would mask half the conversation
                    entries.append((value, ident))
        for value, ident in sorted(entries, key=lambda e: len(e[0]), reverse=True):
            if ident.kind == "name":
                parts = [p for p in re.split(r"[\s　]+", value) if p]
                pattern = _SPACE.join("".join(_char_class(c) for c in part) for part in parts)
                flags = re.IGNORECASE
            else:
                pattern = "".join(_char_class(c) for c in value)
                flags = re.IGNORECASE
            # Do not match inside a longer alphanumeric token for IDs (23B00011 is not 23B0001).
            if ident.kind == "id":
                pattern = r"(?<![0-9A-Za-z０-９Ａ-Ｚａ-ｚ])" + pattern + r"(?![0-9A-Za-z０-９Ａ-Ｚａ-ｚ])"
            self._patterns.append((re.compile(pattern, flags), "{{" + ident.name + "}}"))
        self._by_name = {i.name: i for i in self.identifiers}

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "Masker":
        return cls([Identifier(i["name"], list(i.get("values") or []), i.get("kind", "id"))
                    for i in payload.get("identifiers", [])])

    def mask(self, text: str) -> str:
        if not text or not self._patterns:
            return text
        for pattern, placeholder in self._patterns:
            text = pattern.sub(placeholder, text)
        return text

    def mask_any(self, value: Any) -> Any:
        """Mask every string inside lists / dicts (keys included); other values pass through."""
        if isinstance(value, str):
            return self.mask(value)
        if isinstance(value, list):
            return [self.mask_any(v) for v in value]
        if isinstance(value, tuple):
            return tuple(self.mask_any(v) for v in value)
        if isinstance(value, dict):
            return {self.mask_any(k) if isinstance(k, str) else k: self.mask_any(v) for k, v in value.items()}
        return value

    def contains_real_value(self, text: str) -> bool:
        return self.mask(text) != text

    def value_of(self, name: str) -> str | None:
        ident = self._by_name.get(name)
        return ident.values[0] if ident and ident.values else None

    def placeholders_in(self, value: Any) -> set[str]:
        found: set[str] = set()
        for s in _strings(value):
            found.update(m.group(1) for m in PLACEHOLDER_RE.finditer(s))
        return found

    def substitute(self, value: Any) -> Any:
        """{{NAME}} → real value inside every string (unknown names stay as they are)."""
        if isinstance(value, str):
            return PLACEHOLDER_RE.sub(lambda m: self.value_of(m.group(1)) or m.group(0), value)
        if isinstance(value, list):
            return [self.substitute(v) for v in value]
        if isinstance(value, dict):
            return {k: self.substitute(v) for k, v in value.items()}
        return value


def _strings(value: Any) -> Iterable[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, (list, tuple)):
        for v in value:
            yield from _strings(v)
    elif isinstance(value, dict):
        for v in value.values():
            yield from _strings(v)


def load_payload(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}
