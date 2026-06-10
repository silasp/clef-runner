"""Map the user's master assets onto a festival's application form.

For each field in a festival's ``form_fields`` schema we pull the source value
from the master assets (``maps_to``) and apply a ``transform``:

* ``verbatim`` – copy as-is (names, emails, URLs).
* ``list``     – join a list of items (e.g. photo URLs).
* ``rewrite``  – reshape free text to the field's constraints (word limits,
                 tone, picking from a list of options). Uses the local Qwen
                 model when available, otherwise a deterministic fallback.

Every generated field reports whether the LLM was used and any notes, so the
UI can flag values that need a human eye before submission.
"""

from __future__ import annotations

from . import llm


def _truncate_words(text: str, max_words: int) -> str:
    words = text.split()
    if len(words) <= max_words:
        return text
    clipped = " ".join(words[:max_words]).rstrip(",;:- ")
    if not clipped.endswith((".", "!", "?")):
        clipped += "…"
    return clipped


def _heuristic_rewrite(text: str, field: dict) -> tuple[str, str]:
    """Deterministic fallback when the LLM is unavailable."""
    max_words = field.get("max_words")
    options = field.get("options")
    if options:
        low = text.lower()
        for opt in options:
            if opt.lower() in low or low in opt.lower():
                return opt, "Matched to nearest option (no LLM)"
        return options[-1] if "other" in str(options[-1]).lower() else options[0], \
            "Defaulted to an option (no LLM) — please confirm"
    if max_words:
        out = _truncate_words(text, max_words)
        note = "Truncated to word limit (no LLM)" if out != text else "Within limit"
        return out, note
    return text, "Copied (no LLM)"


def _llm_rewrite(text: str, field: dict, festival_name: str) -> tuple[str, str]:
    max_words = field.get("max_words")
    options = field.get("options")
    label = field.get("label", field["key"])

    system = (
        "You are an assistant that adapts a musician's existing press/application "
        "materials to fit a specific festival application form. Preserve all facts; "
        "never invent achievements, quotes, names, or dates. Match the tone of a "
        "professional artist application. Output ONLY the field value with no "
        "preamble, labels, or quotation marks."
    )
    constraints = []
    if max_words:
        constraints.append(f"Keep it to at most {max_words} words.")
    if options:
        constraints.append(
            "Choose exactly one of these options and output only that option verbatim: "
            + "; ".join(options)
        )
    constraint_text = (" " + " ".join(constraints)) if constraints else ""

    user = (
        f"Festival: {festival_name}\n"
        f"Form field: {label}\n"
        f"Source material:\n{text}\n\n"
        f"Rewrite the source material for this field.{constraint_text}"
    )
    out = llm.generate(system, user)
    out = out.strip().strip('"').strip()
    if options:
        # Snap to the closest valid option in case the model paraphrased.
        low = out.lower()
        for opt in options:
            if opt.lower() in low:
                return opt, "Selected by local LLM"
        return _heuristic_rewrite(out, field)[0], "LLM output snapped to nearest option"
    if max_words and len(out.split()) > max_words:
        out = _truncate_words(out, max_words)
        return out, "Rewritten by local LLM, then trimmed to limit"
    return out, "Rewritten by local LLM"


def generate_application(festival: dict, assets: dict, use_llm: bool = True) -> dict:
    """Produce per-field values for a festival application from master assets."""
    llm_ready = use_llm and llm.is_ready()
    results = []
    for field in festival.get("form_fields", []):
        src_key = field.get("maps_to")
        src_val = assets.get(src_key) if src_key else None
        transform = field.get("transform", "verbatim")
        missing = src_val in (None, "", [], {})

        if transform == "list":
            items = src_val if isinstance(src_val, list) else (
                [src_val] if src_val else []
            )
            value = "\n".join(str(i) for i in items)
            note = "Listed verbatim" if items else "No assets provided"
            llm_used = False
        elif transform == "rewrite" and not missing:
            text = str(src_val)
            if llm_ready:
                try:
                    value, note = _llm_rewrite(text, field, festival.get("name", ""))
                    llm_used = True
                except Exception as exc:  # fall back gracefully on any LLM error
                    value, note = _heuristic_rewrite(text, field)
                    note += f" — LLM error: {exc.__class__.__name__}"
                    llm_used = False
            else:
                value, note = _heuristic_rewrite(text, field)
                llm_used = False
        else:  # verbatim, or a rewrite field with no source data
            value = "" if missing else (
                "\n".join(map(str, src_val)) if isinstance(src_val, list) else str(src_val)
            )
            note = "Copied verbatim" if not missing else "No matching asset — fill in manually"
            llm_used = False

        results.append({
            "key": field["key"],
            "label": field.get("label", field["key"]),
            "type": field.get("type", "text"),
            "required": field.get("required", False),
            "help": field.get("help"),
            "max_words": field.get("max_words"),
            "options": field.get("options"),
            "source_field": src_key,
            "value": value,
            "llm_used": llm_used,
            "note": note,
            "needs_review": missing and field.get("required", False),
        })

    return {
        "festival_id": festival.get("id"),
        "festival_name": festival.get("name"),
        "application_url": festival.get("application_url"),
        "llm": llm.status(),
        "fields": results,
    }
