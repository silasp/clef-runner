"""Local Qwen LLM via Hugging Face ``transformers``.

The model is loaded lazily on first use and cached. If transformers/torch are
not installed, the configured model can't be loaded, or ``FA_DISABLE_LLM`` is
set, callers fall back to a deterministic reshaper (see ``app.mapping``) so the
whole app still works without the heavy dependency.
"""

from __future__ import annotations

import threading

from .config import DISABLE_LLM, LLM_MAX_NEW_TOKENS, QWEN_MODEL

_lock = threading.Lock()
_pipe = None          # cached (tokenizer, model) tuple
_load_error: str | None = None
_loaded = False


def status() -> dict:
    """Report whether the local LLM is usable, without forcing a load."""
    if DISABLE_LLM:
        return {"available": False, "loaded": False, "model": QWEN_MODEL,
                "reason": "Disabled via FA_DISABLE_LLM"}
    try:
        import torch  # noqa: F401
        import transformers  # noqa: F401
    except Exception as exc:  # pragma: no cover - depends on environment
        return {"available": False, "loaded": False, "model": QWEN_MODEL,
                "reason": f"transformers/torch not installed ({exc.__class__.__name__})"}
    return {"available": True, "loaded": _loaded, "model": QWEN_MODEL,
            "reason": _load_error or "ready"}


def _load():
    global _pipe, _load_error, _loaded
    if _pipe is not None or _load_error is not None:
        return
    with _lock:
        if _pipe is not None or _load_error is not None:
            return
        try:
            import torch
            from transformers import AutoModelForCausalLM, AutoTokenizer

            tok = AutoTokenizer.from_pretrained(QWEN_MODEL)
            model = AutoModelForCausalLM.from_pretrained(
                QWEN_MODEL,
                torch_dtype="auto",
                device_map="auto" if torch.cuda.is_available() else None,
            )
            _pipe = (tok, model)
            _loaded = True
        except Exception as exc:  # pragma: no cover - depends on environment
            _load_error = f"{exc.__class__.__name__}: {exc}"


def is_ready() -> bool:
    if DISABLE_LLM:
        return False
    _load()
    return _pipe is not None


def generate(system_prompt: str, user_prompt: str,
             max_new_tokens: int | None = None) -> str:
    """Run a chat-style completion. Raises if the model isn't available."""
    if not is_ready():
        raise RuntimeError(_load_error or "Local LLM unavailable")
    import torch

    tok, model = _pipe
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]
    text = tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    inputs = tok([text], return_tensors="pt").to(model.device)
    with torch.no_grad():
        generated = model.generate(
            **inputs,
            max_new_tokens=max_new_tokens or LLM_MAX_NEW_TOKENS,
            do_sample=True,
            temperature=0.7,
            top_p=0.9,
            pad_token_id=tok.eos_token_id,
        )
    new_tokens = generated[0][inputs.input_ids.shape[1]:]
    return tok.decode(new_tokens, skip_special_tokens=True).strip()
