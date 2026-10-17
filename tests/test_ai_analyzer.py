import asyncio
import json
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
import pytest
from pydantic import ValidationError

from services.ai_worker.analyzer import AnalysisSettings, UNMEASURED, analyze_experiment
from services.ai_worker.prompts import LLMExperimentAnalysis
from services.common.models import Experiment, ExperimentStatus, FaultType, TelemetrySnapshot
from services.experiment_controller.main import ExperimentStart


def data(fault=FaultType.LATENCY):
    start = datetime(2026, 10, 17, tzinfo=timezone.utc)
    parameters = {
        FaultType.LATENCY: {"latency_ms": 400, "jitter_ms": 50},
        FaultType.TIMEOUT: {"timeout_ms": 0},
        FaultType.ERROR_RATE: {"mode": "http_503", "error_rate_percent": 40},
        FaultType.BANDWIDTH: {"rate_kbps": 10},
    }[fault]
    experiment = Experiment(id=uuid4(), name="test", fault_type=fault, target_service="inventory_service",
                            parameters=parameters, slo_max_error_rate=0.1, slo_max_p95_ms=500,
                            status=ExperimentStatus.ABORTED_SLO_BREACH, abort_reason="SLO breach",
                            started_at=start, ended_at=start + timedelta(seconds=6))
    snapshots = [TelemetrySnapshot(id=uuid4(), experiment_id=experiment.id,
                                  timestamp=start + timedelta(seconds=2 * i), total_requests=100,
                                  failed_requests=20 + i, error_rate=(20 + i) / 100,
                                  p95_latency_ms=600.125 + i, queue_depth=i * 3) for i in range(3)]
    return experiment, snapshots


def live_settings(**kwargs):
    return AnalysisSettings(USE_MOCK_AI=False, LLM_API_URL="https://provider.test/chat/completions",
                            LLM_API_KEY="unit-test-key", LLM_MODEL="test-model", **kwargs)


@pytest.mark.asyncio
@pytest.mark.parametrize("fault", list(FaultType))
async def test_mock_is_deterministic_grounded_and_catalog_compatible(fault):
    experiment, rows = data(fault)
    http = AsyncMock()
    result = await analyze_experiment(experiment, rows, settings=AnalysisSettings(), client=http)
    repeated = await analyze_experiment(experiment, list(reversed(rows)), settings=AnalysisSettings())
    assert result == repeated
    assert http.mock_calls == []
    assert "longest breach streak was 3" in result.root_cause_summary
    assert UNMEASURED in result.evidence_bullets
    evidence = "\n".join(result.evidence_bullets)
    assert "p95_latency_ms=602.125" in evidence and "error_rate=0.22" in evidence
    assert "total_requests=300" not in evidence
    proposal = result.next_experiment_proposal
    assert isinstance(proposal, dict)
    ExperimentStart(name="follow up", fault_type=proposal["fault_type"], parameters=proposal["suggested_parameters"],
                    slo_max_error_rate=0.1, slo_max_p95_ms=500)


@pytest.mark.asyncio
async def test_empty_zero_traffic_and_manual_stop_are_not_misreported():
    experiment, rows = data()
    empty = await analyze_experiment(experiment, [], settings=AnalysisSettings())
    assert empty.confidence_score == 0.15
    assert "cannot be established" in empty.root_cause_summary
    for row in rows:
        row.total_requests = row.failed_requests = 0
        row.error_rate = row.p95_latency_ms = 0
    experiment.status = ExperimentStatus.COMPLETED
    experiment.abort_reason = "MANUAL_STOP"
    result = await analyze_experiment(experiment, rows, settings=AnalysisSettings())
    assert "zero requests" in result.root_cause_summary
    assert "not a confirmed safe" in result.root_cause_summary
    assert result.confidence_score <= 0.25


@pytest.mark.asyncio
async def test_equality_does_not_breach_and_simulation_limits_confidence():
    experiment, rows = data()
    experiment.status, experiment.abort_reason = ExperimentStatus.COMPLETED, None
    experiment.parameters["_controller"] = {"simulated": True}
    for row in rows:
        row.error_rate = 0.1
        row.p95_latency_ms = 500
    result = await analyze_experiment(experiment, rows, settings=AnalysisSettings())
    assert "No recorded snapshot exceeded" in result.root_cause_summary
    assert "simulated" in result.root_cause_summary
    assert result.confidence_score <= 0.35


@pytest.mark.asyncio
async def test_foreign_snapshots_are_rejected():
    experiment, rows = data()
    rows[0].experiment_id = uuid4()
    with pytest.raises(ValueError, match="another experiment"):
        await analyze_experiment(experiment, rows, settings=AnalysisSettings())


@pytest.mark.asyncio
@pytest.mark.parametrize("change", [
    {"confidence_score": 1.1}, {"confidence_score": "0.5"}, {"confidence_score": float("nan")},
    {"unexpected": True}, {"evidence_bullets": ["one"]},
    {"next_experiment_proposal": {"fault_type": "EXECUTE", "suggested_parameters": {}, "rationale": "bad"}},
    {"next_experiment_proposal": {"fault_type": "LATENCY", "suggested_parameters": {"latency_ms": True, "jitter_ms": 0}, "rationale": "bad"}},
    {"next_experiment_proposal": {"fault_type": "TIMEOUT", "suggested_parameters": {"timeout_ms": -1}, "rationale": "bad"}},
])
async def test_strict_schema_rejects_invalid_output(change):
    experiment, rows = data()
    result = await analyze_experiment(experiment, rows, settings=AnalysisSettings())
    with pytest.raises(ValidationError):
        LLMExperimentAnalysis.model_validate(result.model_dump() | change)


def test_provider_schema_closes_all_objects_and_requires_every_key():
    schema = LLMExperimentAnalysis.model_json_schema()

    def visit(value):
        if isinstance(value, dict):
            if value.get("type") == "object":
                assert value["additionalProperties"] is False
                assert set(value["required"]) == set(value["properties"])
            for child in value.values():
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)

    visit(schema)


@pytest.mark.asyncio
async def test_live_request_uses_strict_schema_and_accepts_grounded_response():
    experiment, rows = data()
    template = (await analyze_experiment(experiment, rows, settings=AnalysisSettings())).model_dump()
    calls = []

    def handler(request):
        calls.append(request)
        body = json.loads(request.content)
        context = json.loads(body["messages"][1]["content"])
        assert body["model"] == "test-model"
        assert body["response_format"]["json_schema"]["strict"] is True
        assert len(context["telemetry_snapshots"]) == 3
        assert request.headers["authorization"] == "Bearer unit-test-key"
        template["evidence_bullets"] = context["verified_evidence"]
        return httpx.Response(200, json={"choices": [{"finish_reason": "stop", "message": {"content": json.dumps(template)}}]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        result = await analyze_experiment(experiment, rows, settings=live_settings(), client=http)
    assert len(calls) == 1
    assert result.evidence_bullets[-1] == "Analysis mode: live structured-output provider."


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", [429, 500, 401, "network", "invalid_json", "refusal", "bad_evidence", "timeout", "oversized"])
async def test_provider_failures_fall_back_without_losing_telemetry(failure):
    experiment, rows = data()
    calls = []

    async def handler(request):
        calls.append(request)
        if isinstance(failure, int):
            return httpx.Response(failure)
        if failure == "network":
            raise httpx.ConnectError("offline")
        if failure == "timeout":
            await asyncio.sleep(1)
        if failure == "oversized":
            return httpx.Response(200, content=b"x" * 2048)
        if failure == "refusal":
            return httpx.Response(200, json={"choices": [{"finish_reason": "stop", "message": {"refusal": "no"}}]})
        if failure == "bad_evidence":
            template = (await analyze_experiment(experiment, rows, settings=AnalysisSettings())).model_dump()
            template["evidence_bullets"] = ["invented observation"] * 3
            return httpx.Response(200, json={"choices": [{"finish_reason": "stop", "message": {"content": json.dumps(template)}}]})
        return httpx.Response(200, content=b"not json")

    settings = live_settings(LLM_TIMEOUT_SECONDS=0.01 if failure == "timeout" else 20,
                             LLM_MAX_RESPONSE_BYTES=1024 if failure == "oversized" else 131072)
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        result = await analyze_experiment(experiment, rows, settings=settings, client=http)
    assert len(calls) == 1
    assert "deterministic fallback" in result.evidence_bullets[-1]
    assert any("p95_latency_ms=602.125" in evidence for evidence in result.evidence_bullets)


@pytest.mark.asyncio
async def test_cancellation_does_not_fall_back_or_hide_shutdown():
    experiment, rows = data()

    async def handler(request):
        raise asyncio.CancelledError()

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        with pytest.raises(asyncio.CancelledError):
            await analyze_experiment(experiment, rows, settings=live_settings(), client=http)


def test_live_configuration_requires_endpoint_model_and_key():
    with pytest.raises(ValidationError):
        AnalysisSettings(USE_MOCK_AI=False)
