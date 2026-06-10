"""API tests. The LLM is disabled so these run fast and offline."""

import os
import tempfile

os.environ.setdefault("FA_DISABLE_LLM", "1")
# Use a throwaway DB so tests never touch a real one.
_tmp = tempfile.mkdtemp()
os.environ["FA_DATA_DIR"] = _tmp
os.environ["FA_DB_PATH"] = os.path.join(_tmp, "test.db")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

client = TestClient(app)


def test_festivals_seeded_across_regions():
    with TestClient(app) as c:  # triggers startup/seed
        fests = c.get("/api/festivals").json()
    assert len(fests) >= 25
    countries = {f["country"] for f in fests}
    assert {"Australia", "New Zealand"} <= countries
    assert any(f["region"] == "Europe" for f in fests)
    assert any(f["region"] == "North America" for f in fests)
    # Every festival carries the required research fields.
    for f in fests:
        assert f["name"] and f["url"] and f["location"]
        assert isinstance(f["form_fields"], list) and f["form_fields"]


def test_filters_endpoint():
    with TestClient(app) as c:
        data = c.get("/api/festivals/filters").json()
    assert "Australia" in data["countries"]
    assert "folk" in data["genres"]
    assert data["count"] >= 25


def test_filter_by_country():
    with TestClient(app) as c:
        nz = c.get("/api/festivals?country=New Zealand").json()
    assert nz and all(f["country"] == "New Zealand" for f in nz)


def test_assets_roundtrip():
    with TestClient(app) as c:
        payload = {"act_name": "The Testers", "email": "band@example.com",
                   "bio": "word " * 400, "youtube": "https://youtu.be/x",
                   "photo_urls": ["https://img/1.jpg", "https://img/2.jpg"]}
        c.put("/api/assets", json=payload)
        got = c.get("/api/assets").json()
    assert got["act_name"] == "The Testers"
    assert got["photo_urls"] == ["https://img/1.jpg", "https://img/2.jpg"]


def test_generate_maps_and_truncates_without_llm():
    with TestClient(app) as c:
        c.put("/api/assets", json={
            "act_name": "The Testers", "contact_name": "Sam", "email": "b@e.com",
            "based_in": "Melbourne", "genre": "folk", "members": 3,
            "bio": "word " * 400, "one_liner": "A great folk band from down under",
            "youtube": "https://youtu.be/x", "photo_urls": ["https://img/1.jpg"],
        })
        fid = c.get("/api/festivals").json()[0]["id"]
        res = c.post(f"/api/festivals/{fid}/generate", json={"use_llm": True}).json()

    assert res["llm"]["available"] is False  # disabled in tests
    by_key = {f["key"]: f for f in res["fields"]}
    assert by_key["act_name"]["value"] == "The Testers"      # verbatim
    assert by_key["email"]["value"] == "b@e.com"
    # Bio should be trimmed to the field's word limit by the fallback.
    bio = by_key["artist_bio"]
    assert len(bio["value"].split()) <= bio["max_words"] + 1
    assert bio["llm_used"] is False
    assert "https://img/1.jpg" in by_key["photos"]["value"]


def test_save_and_list_drafts():
    with TestClient(app) as c:
        fid = c.get("/api/festivals").json()[0]["id"]
        c.post("/api/applications", json={"festival_id": fid,
                                          "values": {"act_name": "The Testers"}})
        drafts = c.get("/api/applications").json()
    assert drafts and drafts[0]["festival_id"] == fid


def test_generate_select_field_snaps_to_option():
    """Festivals with a genre <select> should resolve to a valid option."""
    with TestClient(app) as c:
        c.put("/api/assets", json={"act_name": "X", "email": "b@e.com",
                                   "based_in": "TX", "genre": "bluegrass",
                                   "bio": "hello", "youtube": "https://y/x"})
        fests = c.get("/api/festivals?search=Telluride").json()
        assert fests
        res = c.post(f"/api/festivals/{fests[0]['id']}/generate",
                     json={"use_llm": True}).json()
    genre = next(f for f in res["fields"] if f["key"] == "genre")
    assert genre["value"] in genre["options"]
