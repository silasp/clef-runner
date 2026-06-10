"""Runtime configuration, all overridable via environment variables."""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("FA_DATA_DIR", BASE_DIR / "data"))
DB_PATH = Path(os.environ.get("FA_DB_PATH", DATA_DIR / "festival_apply.db"))
STATIC_DIR = BASE_DIR / "static"

# --- Local LLM (Qwen via Hugging Face transformers) ---
# Default to a small instruct model that runs on CPU. Override for a bigger one
# if you have the hardware, e.g. QWEN_MODEL=Qwen/Qwen2.5-7B-Instruct
QWEN_MODEL = os.environ.get("QWEN_MODEL", "Qwen/Qwen2.5-1.5B-Instruct")
# Set FA_DISABLE_LLM=1 to force the deterministic fallback (handy for tests/CI).
DISABLE_LLM = os.environ.get("FA_DISABLE_LLM", "") not in ("", "0", "false", "False")
LLM_MAX_NEW_TOKENS = int(os.environ.get("QWEN_MAX_NEW_TOKENS", "512"))

DATA_DIR.mkdir(parents=True, exist_ok=True)
