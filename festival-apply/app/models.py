"""Pydantic request/response models."""

from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, Field


class Assets(BaseModel):
    """The musician's master application assets, entered once and reused."""

    act_name: str = ""
    contact_name: str = ""
    email: str = ""
    phone: str = ""
    based_in: str = ""
    country: str = ""
    genre: str = ""
    members: Optional[int] = None
    years_active: str = ""
    bio: str = ""
    short_bio: str = ""
    one_liner: str = ""
    influences: str = ""
    website: str = ""
    facebook: str = ""
    instagram: str = ""
    youtube: str = ""
    spotify: str = ""
    bandcamp: str = ""
    epk: str = ""
    press_quotes: str = ""
    photo_urls: list[str] = Field(default_factory=list)
    availability: str = ""
    fee: str = ""

    model_config = {"extra": "allow"}


class GenerateRequest(BaseModel):
    use_llm: bool = True
    # Optional one-off overrides merged over the saved master assets.
    overrides: dict[str, Any] = Field(default_factory=dict)


class SaveApplicationRequest(BaseModel):
    festival_id: int
    values: dict[str, Any]
    status: str = "draft"
    application_id: Optional[int] = None
