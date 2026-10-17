"""Deterministic local diagnostics with bounded live-provider fallback."""

import asyncio
import json
import logging
from collections.abc import Sequence
from functools import lru_cache
from typing import Any

import httpx
from pydantic import AnyHttpUrl, Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from services.common.models import Experiment, ExperimentStatus, FaultType, TelemetrySnapshot
from services.common.schemas import ExperimentResponse, TelemetrySnapshotResponse
from .prompts import LLMExperimentAnalysis, SYSTEM_PROMPT

logger = logging.getLogger(__name__)
UNMEASURED = (
    "Retry count and circuit-breaker state/transitions are not measured by TelemetrySnapshot; "
    "retry amplification or breaker activation cannot be confirmed from this timeline."
)


class AnalysisSettings(BaseSettings):
    model_config = SettingsConfigDict(case_sensitive=True, extra="ignore")
    USE_MOCK_AI: bool = True
    LLM_API_KEY: SecretStr | None = None
    LLM_API_URL: AnyHttpUrl | None = None
    LLM_MODEL: str | None = Field(default=None, min_length=1)
    LLM_TIMEOUT_SECONDS: float = Field(default=20, gt=0, le=45, allow_inf_nan=False)
    LLM_MAX_INPUT_BYTES: int = Field(default=1048576, ge=1024, le=8388608)
    LLM_MAX_RESPONSE_BYTES: int = Field(default=131072, ge=1024, le=1048576)
    LLM_TEMPERATURE: float | None = Field(default=None, ge=0, le=2, allow_inf_nan=False)

    @model_validator(mode="after")
    def require_provider_settings(self) -> "AnalysisSettings":
        if not self.USE_MOCK_AI and (
            self.LLM_API_URL is None or not self.LLM_MODEL or not self.LLM_MODEL.strip()
            or self.LLM_API_KEY is None or not self.LLM_API_KEY.get_secret_value().strip()
        ):
            raise ValueError("Live analysis requires LLM_API_URL, LLM_MODEL, and LLM_API_KEY")
        return self


@lru_cache
def get_analysis_settings() -> AnalysisSettings:
    return AnalysisSettings()


def _sample_line(label: str, row: TelemetrySnapshotResponse) -> str:
    return (
        f"{label} snapshot {row.id} at {row.timestamp.isoformat()}: "
        f"p95_latency_ms={row.p95_latency_ms!r}, error_rate={row.error_rate!r}, "
        f"total_requests={row.total_requests}, failed_requests={row.failed_requests}, "
        f"queue_depth={row.queue_depth}."
    )


def _facts(experiment: ExperimentResponse, rows: list[TelemetrySnapshotResponse]) -> dict[str, Any]:
    streak = longest = breaches = 0
    for row in rows:
        breached = row.error_rate > experiment.slo_max_error_rate or row.p95_latency_ms > experiment.slo_max_p95_ms
        streak = streak + 1 if breached else 0
        longest = max(longest, streak)
        breaches += int(breached)
    has_traffic = any(row.total_requests > 0 for row in rows)
    simulated = experiment.parameters.get("_controller", {}).get("simulated", False)
    confidence = 0.15 if not rows else 0.25 if not has_traffic else min(0.8, 0.5 + 0.05 * min(len(rows), 6))
    if experiment.abort_reason and experiment.status != ExperimentStatus.ABORTED_SLO_BREACH:
        confidence = min(confidence, 0.45)
    if simulated:
        confidence = min(confidence, 0.35)
    evidence = []
    if rows:
        evidence.append(_sample_line("First", rows[0]))
        evidence.append(_sample_line("Last", rows[-1]))
        evidence.append(_sample_line("Maximum recorded P95", max(rows, key=lambda row: row.p95_latency_ms)))
        evidence.append(_sample_line("Maximum recorded error rate", max(rows, key=lambda row: row.error_rate)))
        evidence.append(_sample_line("Maximum recorded queue depth", max(rows, key=lambda row: row.queue_depth)))
        evidence.append(
            f"{breaches} of {len(rows)} snapshots exceeded error_rate>{experiment.slo_max_error_rate!r} "
            f"OR p95_latency_ms>{experiment.slo_max_p95_ms!r}; longest consecutive breach streak={longest}."
        )
    else:
        evidence.append("No telemetry snapshots were persisted; P95 latency, error rate, and queue depth are unavailable.")
    evidence.extend([
        UNMEASURED,
        "Snapshots contain overlapping windows bounded by experiment start and the last 60 seconds; counts are not summed. No pre-fault baseline or pending-order counts are available.",
        f"Experiment status={experiment.status.value}; abort_reason={repr(experiment.abort_reason)[:1000]}; simulated={bool(simulated)}.",
    ])
    return dict(evidence=evidence, confidence=confidence, has_traffic=has_traffic,
                simulated=simulated, breaches=breaches, longest=longest)


def _proposal(experiment: ExperimentResponse, facts: dict[str, Any]) -> dict[str, Any]:
    p = experiment.parameters
    if not facts["has_traffic"]:
        return {"fault_type": "LATENCY", "suggested_parameters": {"latency_ms": 100, "jitter_ms": 0},
                "rationale": "First verify traffic and telemetry with a small controlled delay; collect retry and circuit-breaker measurements."}
    if experiment.fault_type == FaultType.LATENCY:
        current = int(p.get("latency_ms", 400))
        latency = max(1, current // 2) if facts["breaches"] else current + 100
        return {"fault_type": "LATENCY", "suggested_parameters": {
            "latency_ms": min(30000, latency), "jitter_ms": min(30000, int(p.get("jitter_ms", 0)))},
            "rationale": "Vary only the injected delay to locate the SLO boundary after testing the proposed resilience change."}
    if experiment.fault_type == FaultType.TIMEOUT:
        timeout = 500 if int(p.get("timeout_ms", 0)) != 500 else 0
        return {"fault_type": "TIMEOUT", "suggested_parameters": {"timeout_ms": timeout},
                "rationale": "Compare finite connection closure with indefinite response suppression under the same HTTP deadline and load."}
    if experiment.fault_type == FaultType.ERROR_RATE:
        percent = float(p.get("error_rate_percent", 25))
        return {"fault_type": "ERROR_RATE", "suggested_parameters": {
            "mode": p.get("mode", "http_503"), "error_rate_percent": max(0.1, min(100.0, percent / 2))},
            "rationale": "Reduce injected failures while collecting breaker transitions to test whether recovery stabilizes without retry amplification."}
    rate = int(p.get("rate_kbps", 10))
    return {"fault_type": "BANDWIDTH", "suggested_parameters": {
        "rate_kbps": min(1000000, max(1, rate * 2 if facts["breaches"] else rate // 2))},
        "rationale": "Vary the bandwidth limit while keeping request volume and payload size fixed to isolate transfer-time sensitivity."}


def _mock(experiment: ExperimentResponse, rows: list[TelemetrySnapshotResponse],
          facts: dict[str, Any], *, mode: str) -> LLMExperimentAnalysis:
    if not rows:
        summary = "No telemetry was saved, so the experiment's impact and root cause cannot be established."
    elif not facts["has_traffic"]:
        summary = "The recorded windows contain zero requests. Zero reported latency/error rate cannot establish healthy fulfillment under fault."
    else:
        mechanisms = {
            FaultType.LATENCY: "Injected downstream latency can consume the inventory HTTP deadline and increase fulfillment wait time.",
            FaultType.TIMEOUT: "Injected response suppression can cause inventory deadline failures and repeated reservation attempts.",
            FaultType.ERROR_RATE: (
                "Injected inventory HTTP 503 responses can cause transient reservation failures."
                if experiment.parameters.get("mode", "http_503") == "http_503"
                else "Injected TCP resets can interrupt inventory reservation responses."
            ),
            FaultType.BANDWIDTH: "Injected bandwidth restriction can increase response transfer time and consume the inventory HTTP deadline.",
        }
        summary = mechanisms[experiment.fault_type]
        summary += (
            f" {facts['breaches']} recorded snapshots exceeded an SLO; the longest breach streak was {facts['longest']}."
            if facts["breaches"] else " No recorded snapshot exceeded either configured SLO."
        )
        summary += (
            " These observations support a fault-related hypothesis, not proof of a specific retry or circuit-breaker mechanism."
            if not facts["simulated"] else " The timeline alone cannot attribute these observations to the simulated fault."
        )
    if experiment.status == ExperimentStatus.ABORTED_SLO_BREACH:
        summary += " The controller recorded an SLO abort."
        if facts["longest"] < 3:
            summary += " The available timeline does not independently reproduce three consecutive breaches; investigate missing telemetry."
    elif experiment.abort_reason:
        summary += " The run ended with a manual/controller stop reason, so it is not a confirmed safe duration completion."
    if facts["simulated"]:
        summary += " The controller marked fault injection as simulated; do not attribute real fault effects to this run."

    if not facts["has_traffic"]:
        fix = "Verify load reaches Order API and telemetry is persisted; instrument per-experiment retry counts and circuit-breaker transitions before tuning resilience settings."
    elif experiment.fault_type == FaultType.LATENCY:
        fix = (
            "Keep HTTP_TIMEOUT_SECONDS at or below 1.5. Compare injected latency plus jitter with that deadline; "
            "if it cannot fit, test HTTP_MAX_ATTEMPTS=1 instead of increasing the deadline. "
            "For transient delays, test RETRY_BACKOFF_MULTIPLIER_SECONDS=0.1 and RETRY_BACKOFF_MAX_SECONDS=0.5 "
            "against the total order latency SLO, preserving idempotency."
        )
    elif experiment.fault_type == FaultType.TIMEOUT:
        fix = (
            "Test HTTP_MAX_ATTEMPTS=1 with HTTP_TIMEOUT_SECONDS=1.5 for persistent response suppression; "
            "test CIRCUIT_BREAKER_FAILURE_THRESHOLD=3 and CIRCUIT_BREAKER_RECOVERY_SECONDS=5 while recording transitions. "
            "Preserve the order UUID idempotency key because a timed-out reservation may already have committed."
        )
    elif experiment.fault_type == FaultType.ERROR_RATE:
        fix = (
            "Keep retries restricted to transient transport errors and HTTP 408/429/5xx; test HTTP_MAX_ATTEMPTS=2 "
            "with RETRY_BACKOFF_MULTIPLIER_SECONDS=0.1 and RETRY_BACKOFF_MAX_SECONDS=0.5. "
            "Measure actual retry counts and breaker transitions before lowering CIRCUIT_BREAKER_FAILURE_THRESHOLD."
        )
    else:
        fix = (
            "Measure inventory response bytes and reduce response payload size before raising timeout budgets. "
            "Test HTTP_MAX_ATTEMPTS=1 under sustained bandwidth saturation while retaining HTTP_TIMEOUT_SECONDS<=1.5 "
            "and bounded worker concurrency; compare queue depth and P95 at the same offered load."
        )
    return LLMExperimentAnalysis(
        root_cause_summary=summary, confidence_score=facts["confidence"],
        evidence_bullets=[*facts["evidence"], "Analysis mode: " + mode + "."],
        recommended_fix=fix, next_experiment_proposal=_proposal(experiment, facts),
    )


async def _live(http: httpx.AsyncClient, settings: AnalysisSettings,
                experiment: ExperimentResponse, rows: list[TelemetrySnapshotResponse],
                facts: dict[str, Any]) -> LLMExperimentAnalysis:
    context = {"experiment": experiment.model_dump(mode="json"),
               "telemetry_snapshots": [row.model_dump(mode="json") for row in rows],
               "verified_evidence": facts["evidence"], "confidence_ceiling": facts["confidence"]}
    payload = {
        "model": settings.LLM_MODEL,
        "messages": [{"role": "system", "content": SYSTEM_PROMPT},
                     {"role": "user", "content": json.dumps(context, allow_nan=False)}],
        "response_format": {"type": "json_schema", "json_schema": {
            "name": "failurelab_experiment_analysis", "strict": True,
            "schema": LLMExperimentAnalysis.model_json_schema(),
        }},
    }
    if settings.LLM_TEMPERATURE is not None:
        payload["temperature"] = settings.LLM_TEMPERATURE
    encoded = json.dumps(payload, allow_nan=False).encode()
    if len(encoded) > settings.LLM_MAX_INPUT_BYTES:
        raise ValueError("Analysis input exceeds configured size limit")
    async with asyncio.timeout(settings.LLM_TIMEOUT_SECONDS):
        async with http.stream(
            "POST", str(settings.LLM_API_URL), content=encoded,
            headers={"Authorization": "Bearer " + settings.LLM_API_KEY.get_secret_value(),
                     "Content-Type": "application/json"},
            timeout=settings.LLM_TIMEOUT_SECONDS, follow_redirects=False,
        ) as response:
            response.raise_for_status()
            body = bytearray()
            async for chunk in response.aiter_bytes():
                body.extend(chunk)
                if len(body) > settings.LLM_MAX_RESPONSE_BYTES:
                    raise ValueError("Analysis response exceeds configured size limit")
    choice = json.loads(body)["choices"][0]
    if choice.get("finish_reason") != "stop" or choice["message"].get("refusal"):
        raise ValueError("Incomplete or refused model response")
    analysis = LLMExperimentAnalysis.model_validate_json(choice["message"]["content"])
    if analysis.evidence_bullets != facts["evidence"]:
        raise ValueError("Model changed verified evidence")
    if analysis.confidence_score > facts["confidence"]:
        raise ValueError("Model confidence exceeded evidence ceiling")
    return LLMExperimentAnalysis.model_validate({
        **analysis.model_dump(),
        "evidence_bullets": [*analysis.evidence_bullets, "Analysis mode: live structured-output provider."],
    })


async def analyze_experiment(
    experiment: Experiment | ExperimentResponse,
    telemetry_snapshots: Sequence[TelemetrySnapshot | TelemetrySnapshotResponse],
    *, settings: AnalysisSettings | None = None, client: httpx.AsyncClient | None = None,
) -> LLMExperimentAnalysis:
    """Local mode performs no I/O or artificial sleep; ordinary timelines target <50 ms."""
    settings = settings or get_analysis_settings()
    experiment = ExperimentResponse.model_validate(experiment)
    rows = sorted((TelemetrySnapshotResponse.model_validate(row) for row in telemetry_snapshots),
                  key=lambda row: (row.timestamp, row.id))
    if any(row.experiment_id != experiment.id for row in rows):
        raise ValueError("Telemetry contains another experiment's snapshots")
    facts = _facts(experiment, rows)
    if settings.USE_MOCK_AI:
        return _mock(experiment, rows, facts, mode="deterministic; no provider call")
    try:
        if client is not None:
            return await _live(client, settings, experiment, rows, facts)
        async with httpx.AsyncClient(trust_env=False) as http:
            return await _live(http, settings, experiment, rows, facts)
    except (httpx.HTTPError, TimeoutError, ValueError, KeyError, IndexError, TypeError) as exc:
        reason = f"HTTP_{exc.response.status_code}" if isinstance(exc, httpx.HTTPStatusError) else type(exc).__name__
        # Never log credentials, endpoint URLs, response bodies, or experiment text.
        logger.warning("Live analysis unavailable/invalid (%s); using deterministic analysis", reason)
        return _mock(experiment, rows, facts, mode="deterministic fallback; " + reason)
