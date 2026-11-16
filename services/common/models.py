"""PostgreSQL models shared by FailureLab services."""

from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import Boolean, CheckConstraint, DateTime, Enum, Float, ForeignKey, Integer, MetaData, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from .database import Base


class OrderStatus(StrEnum):
    PENDING = "PENDING"
    RESERVED = "RESERVED"
    FAILED = "FAILED"


class FaultType(StrEnum):
    LATENCY = "LATENCY"
    TIMEOUT = "TIMEOUT"
    ERROR_RATE = "ERROR_RATE"
    BANDWIDTH = "BANDWIDTH"


class ExperimentStatus(StrEnum):
    PLANNED = "PLANNED"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    ABORTED_SLO_BREACH = "ABORTED_SLO_BREACH"


class Order(Base):
    __tablename__ = "orders"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="positive_quantity"),
        CheckConstraint("latency_ms >= 0 AND latency_ms < 'Infinity'::float8", name="valid_latency"),
    )

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    customer_id: Mapped[str] = mapped_column(String(255))
    sku: Mapped[str] = mapped_column(String(255))
    quantity: Mapped[int] = mapped_column(Integer)
    status: Mapped[OrderStatus] = mapped_column(Enum(OrderStatus, name="order_status"), default=OrderStatus.PENDING, server_default="PENDING")
    latency_ms: Mapped[float] = mapped_column(Float, default=0.0, server_default="0")
    error_reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class OutboxEvent(Base):
    __tablename__ = "outbox_events"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    aggregate_id: Mapped[UUID] = mapped_column(ForeignKey("orders.id", ondelete="RESTRICT"), index=True)
    event_type: Mapped[str] = mapped_column(String(255))
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB)
    processed: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class InventoryItem(Base):
    __tablename__ = "inventory_items"
    __table_args__ = (CheckConstraint("available_qty >= 0", name="nonnegative_stock"),)

    sku: Mapped[str] = mapped_column(String(255), primary_key=True)
    available_qty: Mapped[int] = mapped_column(Integer)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class IdempotencyRecord(Base):
    __tablename__ = "idempotency_records"
    __table_args__ = (CheckConstraint("response_status BETWEEN 100 AND 599", name="http_status"),)

    idempotency_key: Mapped[str] = mapped_column(String(255), primary_key=True)
    # Deliberately no cross-service order FK: inventory may own a separate DB.
    order_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), index=True)
    response_status: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Experiment(Base):
    __tablename__ = "experiments"
    __table_args__ = (
        CheckConstraint("slo_max_error_rate BETWEEN 0 AND 1", name="valid_slo_error_rate"),
        CheckConstraint("slo_max_p95_ms > 0 AND slo_max_p95_ms < 'Infinity'::float8", name="valid_slo_latency"),
        CheckConstraint("ended_at IS NULL OR (started_at IS NOT NULL AND ended_at >= started_at)", name="ordered_times"),
    )

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(255))
    fault_type: Mapped[FaultType] = mapped_column(Enum(FaultType, name="fault_type"))
    target_service: Mapped[str] = mapped_column(String(255))
    parameters: Mapped[dict[str, Any]] = mapped_column(JSONB)
    slo_max_error_rate: Mapped[float] = mapped_column(Float)
    slo_max_p95_ms: Mapped[float] = mapped_column(Float)
    status: Mapped[ExperimentStatus] = mapped_column(Enum(ExperimentStatus, name="experiment_status"), default=ExperimentStatus.PLANNED, server_default="PLANNED")
    abort_reason: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class TelemetrySnapshot(Base):
    __tablename__ = "telemetry_snapshots"
    __table_args__ = (
        CheckConstraint("total_requests >= 0 AND failed_requests >= 0 AND failed_requests <= total_requests", name="valid_counts"),
        CheckConstraint("error_rate BETWEEN 0 AND 1", name="valid_error_rate"),
        CheckConstraint("p95_latency_ms >= 0 AND p95_latency_ms < 'Infinity'::float8", name="valid_p95"),
        CheckConstraint("queue_depth >= 0", name="nonnegative_queue"),
    )

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    experiment_id: Mapped[UUID] = mapped_column(ForeignKey("experiments.id", ondelete="CASCADE"), index=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    total_requests: Mapped[int] = mapped_column(Integer)
    failed_requests: Mapped[int] = mapped_column(Integer)
    error_rate: Mapped[float] = mapped_column(Float)
    p95_latency_ms: Mapped[float] = mapped_column(Float)
    queue_depth: Mapped[int] = mapped_column(Integer)


class AIReport(Base):
    __tablename__ = "ai_reports"
    __table_args__ = (CheckConstraint("confidence_score BETWEEN 0 AND 1", name="valid_confidence"),)

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    experiment_id: Mapped[UUID] = mapped_column(ForeignKey("experiments.id", ondelete="CASCADE"), index=True)
    root_cause_summary: Mapped[str] = mapped_column(Text)
    confidence_score: Mapped[float] = mapped_column(Float)
    evidence_bullets: Mapped[list[str]] = mapped_column(JSONB)
    recommended_fix: Mapped[str] = mapped_column(Text)
    next_experiment_proposal: Mapped[dict[str, Any]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AuthBase(DeclarativeBase):
    """Controller-owned auth tables; reliability services keep their seven-table schema."""

    metadata = MetaData(naming_convention=Base.metadata.naming_convention)


class User(AuthBase):
    __tablename__ = "auth_users"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    email: Mapped[str] = mapped_column(String(254), unique=True)
    first_name: Mapped[str] = mapped_column(String(100))
    last_name: Mapped[str] = mapped_column(String(100))
    password_hash: Mapped[str | None] = mapped_column(Text)
    password_history: Mapped[list[str]] = mapped_column(JSONB, default=list)
    failed_login_attempts: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PasswordResetCode(AuthBase):
    __tablename__ = "password_reset_codes"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("auth_users.id", ondelete="CASCADE"), index=True)
    code_hash: Mapped[str] = mapped_column(String(64))
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    verified: Mapped[bool] = mapped_column(Boolean, default=False)
    consumed: Mapped[bool] = mapped_column(Boolean, default=False)
    reset_token_hash: Mapped[str | None] = mapped_column(String(64))


class AuthSession(AuthBase):
    __tablename__ = "auth_sessions"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("auth_users.id", ondelete="CASCADE"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class ProviderIdentity(AuthBase):
    __tablename__ = "auth_provider_identities"
    provider: Mapped[str] = mapped_column(String(16), primary_key=True)
    subject: Mapped[str] = mapped_column(String(255), primary_key=True)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("auth_users.id", ondelete="CASCADE"), index=True)


class OAuthTransaction(AuthBase):
    __tablename__ = "auth_oauth_transactions"
    state_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    browser_hash: Mapped[str] = mapped_column(String(64))
    provider: Mapped[str] = mapped_column(String(16))
    verifier: Mapped[str] = mapped_column(String(128))
    nonce: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    link_user_id: Mapped[UUID | None] = mapped_column(ForeignKey("auth_users.id", ondelete="CASCADE"))
    session_hash: Mapped[str | None] = mapped_column(String(64))


class OperatorRole(AuthBase):
    """Explicit, operator-managed grants. Signup can never assign this role."""
    __tablename__ = "auth_operator_roles"
    user_id: Mapped[UUID] = mapped_column(ForeignKey("auth_users.id", ondelete="CASCADE"), primary_key=True)
