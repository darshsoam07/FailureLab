"""Validated API inputs and ORM-compatible response contracts."""

from typing import Annotated
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, JsonValue, SecretStr, StringConstraints, field_validator, model_validator

from .models import ExperimentStatus, FaultType, OrderStatus

Identifier = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
NonemptyText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
NonnegativeInt = Annotated[int, Field(ge=0, le=2_147_483_647, strict=True)]
PositiveInt = Annotated[int, Field(gt=0, le=2_147_483_647, strict=True)]
NonnegativeFloat = Annotated[float, Field(ge=0, allow_inf_nan=False)]
PositiveFloat = Annotated[float, Field(gt=0, allow_inf_nan=False)]
Rate = Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]
HttpStatus = Annotated[int, Field(ge=100, le=599, strict=True)]
JsonObject = dict[str, JsonValue]


class Schema(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid", allow_inf_nan=False)


class OrderCreate(Schema):
    customer_id: Identifier
    sku: Identifier
    quantity: PositiveInt


class OrderResponse(OrderCreate):
    id: UUID
    status: OrderStatus
    latency_ms: NonnegativeFloat
    error_reason: str | None
    created_at: AwareDatetime


class OutboxEventCreate(Schema):
    aggregate_id: UUID
    event_type: Identifier
    payload: JsonObject


class OutboxEventResponse(OutboxEventCreate):
    id: UUID
    processed: bool
    created_at: AwareDatetime


class InventoryItemCreate(Schema):
    sku: Identifier
    available_qty: NonnegativeInt


class InventoryItemResponse(InventoryItemCreate):
    updated_at: AwareDatetime


class IdempotencyRecordCreate(Schema):
    idempotency_key: Identifier
    order_id: UUID
    response_status: HttpStatus


class IdempotencyRecordResponse(IdempotencyRecordCreate):
    created_at: AwareDatetime


class ExperimentCreate(Schema):
    name: Identifier
    fault_type: FaultType
    target_service: Identifier
    parameters: JsonObject
    slo_max_error_rate: Rate
    slo_max_p95_ms: PositiveFloat


class ExperimentResponse(ExperimentCreate):
    id: UUID
    status: ExperimentStatus
    abort_reason: str | None
    started_at: AwareDatetime | None
    ended_at: AwareDatetime | None

    @model_validator(mode="after")
    def validate_times(self) -> "ExperimentResponse":
        if self.ended_at is not None and (
            self.started_at is None or self.ended_at < self.started_at
        ):
            raise ValueError("ended_at requires started_at and cannot precede it")
        return self


class TelemetrySnapshotCreate(Schema):
    experiment_id: UUID
    total_requests: NonnegativeInt
    failed_requests: NonnegativeInt
    error_rate: Rate
    p95_latency_ms: NonnegativeFloat
    queue_depth: NonnegativeInt

    @model_validator(mode="after")
    def validate_counts(self) -> "TelemetrySnapshotCreate":
        if self.failed_requests > self.total_requests:
            raise ValueError("failed_requests cannot exceed total_requests")
        return self


class TelemetrySnapshotResponse(TelemetrySnapshotCreate):
    id: UUID
    timestamp: AwareDatetime


class AIReportCreate(Schema):
    experiment_id: UUID
    root_cause_summary: NonemptyText
    confidence_score: Rate
    evidence_bullets: list[NonemptyText]
    recommended_fix: NonemptyText
    next_experiment_proposal: JsonObject


class AIReportResponse(AIReportCreate):
    id: UUID
    created_at: AwareDatetime


class AuthEmail(Schema):
    email: str = Field(min_length=3, max_length=254)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        import re
        value = value.strip().casefold()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
            raise ValueError("Enter a valid email address")
        return value


class AuthLogin(AuthEmail):
    password: SecretStr = Field(min_length=1, max_length=128)


class AuthSignup(AuthEmail):
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    password: SecretStr = Field(min_length=12, max_length=128)
    terms_accepted: bool

    @field_validator("first_name", "last_name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Name cannot be blank")
        return value

    @field_validator("terms_accepted")
    @classmethod
    def require_terms(cls, value: bool) -> bool:
        if not value:
            raise ValueError("Accept the terms to create an account")
        return value


class AuthUserResponse(Schema):
    id: UUID
    email: str
    first_name: str
    last_name: str
    is_demo: bool


class AuthVerifyCode(Schema):
    reset_id: UUID
    code: str = Field(pattern=r"^\d{4}$", min_length=4, max_length=4)


class AuthResetPassword(Schema):
    reset_id: UUID
    reset_token: SecretStr = Field(min_length=32, max_length=128)
    password: SecretStr = Field(min_length=12, max_length=128)


class AuthOAuthMock(Schema):
    provider: Annotated[str, StringConstraints(pattern=r"^(google|facebook)$")]
