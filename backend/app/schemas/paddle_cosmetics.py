from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class PaddleFlightEquipment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    background: str = Field(min_length=1, max_length=32)
    paddle: str = Field(min_length=1, max_length=32)
    ball: str = Field(min_length=1, max_length=32)


class PaddleFlightCosmeticsRead(BaseModel):
    owned: list[str]
    equipped: PaddleFlightEquipment
    opened_chests: int = Field(ge=0)


class PaddleFlightChestRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    claim_id: UUID


class PaddleFlightChestResponse(BaseModel):
    cosmetics: PaddleFlightCosmeticsRead
    skin_id: str
    duplicate: bool
