"""Live HTTP verification. Requires running local services; never restarts workers."""
import asyncio
import json
import time
from datetime import datetime, timezone
import asyncpg
from pydantic import AnyHttpUrl, PostgresDsn
from pydantic_settings import BaseSettings
from pathlib import Path

import httpx


class VerificationSettings(BaseSettings):
    ORDER_API_URL: AnyHttpUrl
    CONTROLLER_API_URL: AnyHttpUrl
    TOXIPROXY_API_URL: AnyHttpUrl
    DATABASE_URL: PostgresDsn


OUTPUT = Path('.logs/verification-fixed/scenario.json')
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
results = {}


def record(key, value):
    results[key] = value
    OUTPUT.write_text(json.dumps(results, indent=2))
    print(key + '=' + json.dumps(value), flush=True)


async def main():
    settings = VerificationSettings()
    order = str(settings.ORDER_API_URL).rstrip('/')
    controller = str(settings.CONTROLLER_API_URL).rstrip('/')
    toxi = str(settings.TOXIPROXY_API_URL).rstrip('/')
    run_started = datetime.now(timezone.utc)
    record('run_started', run_started.isoformat())
    active = None
    from services.common.authorization import internal_headers
    async with httpx.AsyncClient(timeout=20, trust_env=False) as http:
        async def call(method, path, payload=None, base=controller):
            response = await http.request(method, base + path,
                headers=internal_headers() if base in {order, controller} else {},
                **({'json': payload} if payload is not None else {}))
            response.raise_for_status()
            return response.json()

        async def await_experiment(experiment_id, *, report=False, seconds=90):
            deadline = time.monotonic() + seconds
            while time.monotonic() < deadline:
                detail = await call('GET', f'/api/experiments/{experiment_id}')
                if detail['status'] not in ('RUNNING', 'PLANNED') and (not report or detail['ai_report']):
                    return detail
                await asyncio.sleep(1)
            raise TimeoutError('Experiment or AI report did not reach the expected state')

        try:
            existing = await call('GET', '/api/experiments?limit=100')
            assert not any(row['status'] in ('PLANNED', 'RUNNING') for row in existing), 'An experiment is already active'
            record('traffic_enabled', await call('POST', '/api/traffic/toggle', {'enabled': True, 'requests_per_second': 5}))
            for elapsed in range(0, 20, 5):
                await asyncio.sleep(5)
                print(f'WARMUP {elapsed + 5}/20 seconds', flush=True)
            samples = []
            for index in range(3):
                metrics = await call('GET', '/api/orders/metrics-summary?window_seconds=10', base=order)
                samples.append(metrics)
                record('warm_baseline_samples', samples)
                assert metrics['succeeded'] >= 30, 'Insufficient completed warm traffic'
                assert metrics['failed'] == 0, 'Baseline contains failed orders'
                assert 0 < metrics['p95_latency_ms'] < 200.0, 'Warm baseline already breaches SLO'
                if index < 2:
                    await asyncio.sleep(5)
            record('baseline_metrics', samples[-1])
            spike = {
                'name': 'Verification: 450ms latency spike', 'fault_type': 'LATENCY',
                'target_service': 'inventory_service', 'parameters': {'latency_ms': 450, 'jitter_ms': 50},
                'duration_seconds': 60, 'slo_max_error_rate': 0.1, 'slo_max_p95_ms': 200,
            }
            started = await call('POST', '/api/experiments/start', spike)
            active = started['id']
            record('spike_started', started)
            detail = await await_experiment(active, report=True)
            record('spike_result', detail)
            assert detail['status'] == 'ABORTED_SLO_BREACH', detail['status']
            during = [sample['p95_latency_ms'] for sample in detail['telemetry_snapshots']]
            record('during_fault_p95_ms', during)
            assert max(during) > 500.0, 'Fault P95 did not exceed the requested 500ms verification threshold'
            active = None
            Path('.logs/verification-fixed/ai-report.json').write_text(json.dumps(detail['ai_report'], indent=2))
            print('AI_REPORT_JSON\n' + json.dumps(detail['ai_report'], indent=2), flush=True)
            proposal = detail['ai_report']['next_experiment_proposal']
            followup = {**spike, 'name': 'Verification: AI proposed follow-up',
                        'fault_type': proposal['fault_type'], 'parameters': proposal['suggested_parameters']}
            started = await call('POST', '/api/experiments/start', followup)
            active = started['id']
            record('followup_started', started)
            stopped = await call('POST', f'/api/experiments/{active}/stop')
            record('followup_stopped', stopped)
            assert stopped['status'] == 'COMPLETED' and stopped['abort_reason'] == 'MANUAL_STOP'
            active = None
            toxics = await call('GET', '/proxies/inventory_proxy/toxics', base=toxi)
            record('toxics_after_kill_switch', toxics)
            assert toxics == []
            # Start the control immediately: its own telemetry window must exclude
            # the preceding fault, without a manual cooldown or worker restart.
            record('pre_zero_latency_metrics', await call('GET', '/api/orders/metrics-summary', base=order))
            zero = {**spike, 'name': 'Verification: 15s zero-latency control',
                    'parameters': {'latency_ms': 0, 'jitter_ms': 0},
                    'duration_seconds': 15, 'slo_max_p95_ms': 200}
            started = await call('POST', '/api/experiments/start', zero)
            active = started['id']
            record('zero_latency_started', started)
            completed = await await_experiment(active, report=True, seconds=60)
            record('zero_latency_result', completed)
            assert completed['status'] == 'COMPLETED' and completed['abort_reason'] is None
            active = None
            record('final_toxics', await call('GET', '/proxies/inventory_proxy/toxics', base=toxi))
            assert results['final_toxics'] == []
            record('final_metrics', await call('GET', '/api/orders/metrics-summary', base=order))
            record('scenario_steps_passed', True)
        except Exception as error:
            record('scenario_error', {'type': type(error).__name__, 'message': str(error)})
            raise
        finally:
            if active:
                record('emergency_cleanup', await call('POST', f'/api/experiments/{active}/stop'))
            disabled = await call('POST', '/api/traffic/toggle', {'enabled': False, 'requests_per_second': 5})
            record('traffic_disabled', disabled)
            await asyncio.sleep(3)
            settled = await call('GET', '/api/traffic/status')
            record('traffic_settled', settled)
            assert not settled['active'] and settled['in_flight'] == 0
            assert settled['total_orders_sent'] == disabled['total_orders_sent']
            connection = await asyncpg.connect(str(settings.DATABASE_URL).replace('postgresql+asyncpg://', 'postgresql://', 1))
            try:
                for _ in range(30):
                    counts = dict(await connection.fetchrow(
                        "SELECT count(*) AS total, count(*) FILTER (WHERE status='RESERVED') AS reserved, "
                        "count(*) FILTER (WHERE status='FAILED') AS failed, count(*) FILTER (WHERE status='PENDING') AS pending "
                        "FROM orders WHERE created_at >= $1", run_started))
                    counts['unprocessed_outbox'] = await connection.fetchval(
                        'SELECT count(*) FROM outbox_events WHERE NOT processed AND created_at >= $1', run_started)
                    if counts['pending'] == counts['unprocessed_outbox'] == 0:
                        break
                    await asyncio.sleep(1)
                record('final_order_counts', counts)
                assert counts['pending'] == counts['unprocessed_outbox'] == counts['failed'] == 0
                assert counts['reserved'] == counts['total']
            finally:
                await connection.close()
        record('scenario_passed', results.get('scenario_steps_passed', False))


asyncio.run(main())
