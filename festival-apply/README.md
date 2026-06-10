# 🎪 Festival Apply

**One set of assets. Every festival form. Drafted by a local LLM.**

Applying to folk and music festivals is repetitive: every festival wants the
same handful of things (a bio, an email, photos, your website, Facebook,
YouTube, Spotify…) but in a slightly different shape — a 150-word bio here, a
60-word bio there, a one-line tagline, a genre picked from *their* list.

Festival Apply keeps your **master assets** in one place, holds a researched
**database of festivals and their application forms**, and uses a **local LLM
(Qwen via Hugging Face)** to reshape your assets to each festival's
requirements. You review and tweak every field before submitting on the
festival's own site.

> The goal: shorter application time, higher-quality applications.

---

## What's inside

- **Festival database** — ~30 folk/roots/music festivals across Australia, New
  Zealand, the UK/Europe and North America that run web-based application
  processes. Each record stores URL, name, location, application open/close
  dates (where known), application status, representative headliners, the form
  platform, and a **schema of the application form's fields**. See
  [`app/festivals_data.py`](app/festivals_data.py).
- **Master assets** — enter your bio, short bio, tagline, contact details,
  links and photo URLs once.
- **Mapping engine** — for each festival, maps your assets onto its form
  fields. URLs/emails are copied verbatim; free-text fields (bios, taglines,
  genre selects) are **rewritten by the local LLM** to fit word limits and
  pick from allowed options. Facts are preserved — the prompt explicitly
  forbids inventing achievements, quotes or dates.
- **Review UI** — every generated value is editable, with live word counts and
  badges showing what the LLM touched and what still needs your input. Copy all
  fields to the clipboard or save a draft, then submit on the festival's site.

## Architecture

```
FastAPI (app/main.py)
 ├── SQLite (app/database.py)         festivals · master assets · saved drafts
 ├── Festival data (app/festivals_data.py)   researched + form-field schemas
 ├── Mapping engine (app/mapping.py)  assets ──▶ per-festival form values
 ├── Local LLM (app/llm.py)           Qwen via transformers, lazy-loaded
 └── Static SPA (static/)             vanilla HTML/CSS/JS
```

The app **runs fully without the LLM** — if `transformers`/`torch` aren't
installed, free-text fields fall back to deterministic reshaping (truncate to
word limit, snap to nearest option). The "My Assets" data and drafts persist in
SQLite; festival records are re-seeded from `festivals_data.py` on startup.

## Quick start

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Run it
uvicorn app.main:app --reload
# open http://127.0.0.1:8000
```

### Enable the local LLM (optional)

```bash
pip install -r requirements-llm.txt   # transformers, torch, accelerate
# defaults to a small CPU-friendly model; override if you have the hardware:
export QWEN_MODEL=Qwen/Qwen2.5-3B-Instruct
uvicorn app.main:app
```

The model downloads from Hugging Face on first use and is cached. To force the
deterministic fallback (e.g. in CI): `export FA_DISABLE_LLM=1`.

## Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `QWEN_MODEL` | `Qwen/Qwen2.5-1.5B-Instruct` | Hugging Face model id |
| `FA_DISABLE_LLM` | unset | Set to `1` to skip the LLM entirely |
| `QWEN_MAX_NEW_TOKENS` | `512` | Generation length cap |
| `FA_DB_PATH` | `data/festival_apply.db` | SQLite location |
| `FA_DATA_DIR` | `data/` | Data directory |

## API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/festivals` | List/filter festivals (`search`, `country`, `region`, `genre`, `status`) |
| `GET` | `/api/festivals/filters` | Distinct filter values |
| `GET` | `/api/festivals/{id}` | Festival detail incl. form-field schema |
| `GET`/`PUT` | `/api/assets` | Read/save master assets |
| `POST` | `/api/festivals/{id}/generate` | Map assets → this festival's form |
| `GET`/`POST` | `/api/applications` | List/save drafts |
| `GET` | `/api/llm/status` | Whether the local LLM is available/loaded |

## Tests

```bash
pip install -r requirements-dev.txt
FA_DISABLE_LLM=1 pytest -q
```

## Notes & caveats

- Festival dates and application windows shift each year. Records note typical
  windows and link to each festival's own application page (`application_url`) —
  **always confirm there before applying.** Data compiled June 2026.
- This tool **drafts** applications; it does not auto-submit. You always review
  and submit on the festival's official form.
- The festival list is a starting set, easy to extend — add a dict to
  `FESTIVALS` in `app/festivals_data.py` (use `make_fields(...)` for the form).
