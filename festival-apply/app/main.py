"""FastAPI app: festival database + asset → application-form mapping."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import database, llm
from .config import STATIC_DIR
from .festivals_data import FESTIVALS
from .mapping import generate_application
from .models import Assets, GenerateRequest, SaveApplicationRequest


@asynccontextmanager
async def lifespan(_app: FastAPI):
    database.init_db()
    database.seed_festivals(FESTIVALS)
    yield


app = FastAPI(
    title="Festival Apply",
    description="Map a standard set of application assets onto folk & music "
                "festival application forms, with a local LLM to reshape them.",
    version="0.1.0",
    lifespan=lifespan,
)


# --- Festivals -------------------------------------------------------------

@app.get("/api/festivals")
def get_festivals(search: str | None = None, country: str | None = None,
                  region: str | None = None, genre: str | None = None,
                  status: str | None = None):
    return database.list_festivals(
        search=search, country=country, region=region, genre=genre, status=status
    )


@app.get("/api/festivals/filters")
def festival_filters():
    """Distinct values for building the UI filter controls."""
    fests = database.list_festivals()
    countries = sorted({f["country"] for f in fests if f.get("country")})
    regions = sorted({f["region"] for f in fests if f.get("region")})
    statuses = sorted({f["application_status"] for f in fests if f.get("application_status")})
    genres = sorted({g for f in fests for g in (f.get("genres") or [])})
    return {"countries": countries, "regions": regions,
            "statuses": statuses, "genres": genres, "count": len(fests)}


@app.get("/api/festivals/{festival_id}")
def get_festival(festival_id: int):
    fest = database.get_festival(festival_id)
    if not fest:
        raise HTTPException(404, "Festival not found")
    return fest


# --- Master assets ---------------------------------------------------------

@app.get("/api/assets", response_model=Assets)
def read_assets():
    return Assets(**database.get_assets())


@app.put("/api/assets", response_model=Assets)
def write_assets(assets: Assets):
    saved = database.save_assets(assets.model_dump())
    return Assets(**saved)


# --- Generate / map --------------------------------------------------------

@app.post("/api/festivals/{festival_id}/generate")
def generate(festival_id: int, req: GenerateRequest):
    fest = database.get_festival(festival_id)
    if not fest:
        raise HTTPException(404, "Festival not found")
    assets = {**database.get_assets(), **(req.overrides or {})}
    if not assets:
        raise HTTPException(400, "No master assets saved yet — fill in your profile first.")
    return generate_application(fest, assets, use_llm=req.use_llm)


# --- Saved drafts ----------------------------------------------------------

@app.get("/api/applications")
def list_applications():
    return database.list_applications()


@app.post("/api/applications")
def save_application(req: SaveApplicationRequest):
    fest = database.get_festival(req.festival_id)
    if not fest:
        raise HTTPException(404, "Festival not found")
    return database.save_application(
        req.festival_id, req.values, status=req.status, application_id=req.application_id
    )


@app.get("/api/llm/status")
def llm_status():
    return llm.status()


# --- Static frontend -------------------------------------------------------

if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

    @app.get("/")
    def index():
        return FileResponse(STATIC_DIR / "index.html")
