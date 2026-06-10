"""SQLite persistence for festivals, the user's master assets, and saved drafts.

Festival records are static research data (see ``festivals_data.py``); they are
seeded into the DB on startup so the rest of the app reads everything from one
place and the data can be queried/filtered with SQL.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from typing import Any, Optional

from .config import DB_PATH


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    with _connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS festivals (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                url TEXT,
                application_url TEXT,
                location TEXT,
                country TEXT,
                region TEXT,
                genres TEXT,             -- JSON array
                festival_month TEXT,
                next_edition TEXT,
                application_window TEXT,
                application_opens TEXT,
                application_closes TEXT,
                application_status TEXT,
                form_platform TEXT,
                headliners TEXT,         -- JSON array
                notes TEXT,
                source_url TEXT,
                form_fields TEXT         -- JSON array of field schemas
            );

            CREATE TABLE IF NOT EXISTS assets (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                data TEXT NOT NULL,      -- JSON blob of the master profile
                updated_at TEXT
            );

            CREATE TABLE IF NOT EXISTS applications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                festival_id INTEGER NOT NULL REFERENCES festivals(id),
                festival_name TEXT,
                status TEXT DEFAULT 'draft',
                values_json TEXT NOT NULL,   -- JSON: {field_key: value}
                created_at TEXT,
                updated_at TEXT
            );
            """
        )


# --- Festivals -------------------------------------------------------------

_JSON_FESTIVAL_FIELDS = ("genres", "headliners", "form_fields")


_FESTIVAL_COLS = [
    "name", "url", "application_url", "location", "country", "region",
    "genres", "festival_month", "next_edition", "application_window",
    "application_opens", "application_closes", "application_status",
    "form_platform", "headliners", "notes", "source_url", "form_fields",
]


def seed_festivals(records: list[dict]) -> int:
    """Upsert festival records by name.

    Uses an ON CONFLICT upsert rather than delete-and-reinsert so that festival
    ``id``s stay stable across restarts and saved-application foreign keys are
    never broken, while the static research data is still refreshed.
    """
    placeholders = ",".join("?" for _ in _FESTIVAL_COLS)
    updates = ",".join(f"{c}=excluded.{c}" for c in _FESTIVAL_COLS if c != "name")
    with _connect() as conn:
        for rec in records:
            row = []
            for c in _FESTIVAL_COLS:
                val = rec.get(c)
                if c in _JSON_FESTIVAL_FIELDS:
                    val = json.dumps(val if val is not None else [])
                row.append(val)
            conn.execute(
                f"INSERT INTO festivals ({','.join(_FESTIVAL_COLS)}) "
                f"VALUES ({placeholders}) "
                f"ON CONFLICT(name) DO UPDATE SET {updates}",
                row,
            )
        (count,) = conn.execute("SELECT COUNT(*) FROM festivals").fetchone()
        return count


def _festival_row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    for c in _JSON_FESTIVAL_FIELDS:
        d[c] = json.loads(d[c]) if d.get(c) else []
    return d


def list_festivals(
    *,
    search: Optional[str] = None,
    country: Optional[str] = None,
    region: Optional[str] = None,
    genre: Optional[str] = None,
    status: Optional[str] = None,
) -> list[dict]:
    clauses, params = [], []
    if search:
        clauses.append("(name LIKE ? OR location LIKE ? OR notes LIKE ? OR genres LIKE ?)")
        params += [f"%{search}%"] * 4
    if country:
        clauses.append("country = ?")
        params.append(country)
    if region:
        clauses.append("region = ?")
        params.append(region)
    if genre:
        clauses.append("genres LIKE ?")
        params.append(f"%{genre}%")
    if status:
        clauses.append("application_status = ?")
        params.append(status)
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    with _connect() as conn:
        rows = conn.execute(
            f"SELECT * FROM festivals{where} ORDER BY region, country, name", params
        ).fetchall()
    return [_festival_row_to_dict(r) for r in rows]


def get_festival(festival_id: int) -> Optional[dict]:
    with _connect() as conn:
        row = conn.execute("SELECT * FROM festivals WHERE id = ?", (festival_id,)).fetchone()
    return _festival_row_to_dict(row) if row else None


# --- Master assets ---------------------------------------------------------

def get_assets() -> dict:
    with _connect() as conn:
        row = conn.execute("SELECT data FROM assets WHERE id = 1").fetchone()
    return json.loads(row["data"]) if row else {}


def save_assets(data: dict) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        conn.execute(
            "INSERT INTO assets (id, data, updated_at) VALUES (1, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
            (json.dumps(data), now),
        )
    return data


# --- Saved application drafts ----------------------------------------------

def save_application(festival_id: int, values: dict, status: str = "draft",
                     application_id: Optional[int] = None) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    fest = get_festival(festival_id)
    fest_name = fest["name"] if fest else None
    with _connect() as conn:
        if application_id:
            conn.execute(
                "UPDATE applications SET values_json = ?, status = ?, updated_at = ? WHERE id = ?",
                (json.dumps(values), status, now, application_id),
            )
            new_id = application_id
        else:
            cur = conn.execute(
                "INSERT INTO applications (festival_id, festival_name, status, values_json, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (festival_id, fest_name, status, json.dumps(values), now, now),
            )
            new_id = cur.lastrowid
    return get_application(new_id)


def get_application(application_id: int) -> Optional[dict]:
    with _connect() as conn:
        row = conn.execute("SELECT * FROM applications WHERE id = ?", (application_id,)).fetchone()
    if not row:
        return None
    d = dict(row)
    d["values"] = json.loads(d.pop("values_json"))
    return d


def list_applications() -> list[dict]:
    with _connect() as conn:
        rows = conn.execute("SELECT * FROM applications ORDER BY updated_at DESC").fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["values"] = json.loads(d.pop("values_json"))
        out.append(d)
    return out
