export const FAULT_LABELS = {
  LATENCY: 'Latency Spike', TIMEOUT: 'Upstream Timeout',
  ERROR_RATE: 'Connection Reset / 503 Storm', BANDWIDTH: 'Bandwidth Limit',
};
export const DEFAULT_PARAMETERS = {
  LATENCY: { latency_ms: 450, jitter_ms: 50 }, TIMEOUT: { timeout_ms: 0 },
  ERROR_RATE: { mode: 'http_503', error_rate_percent: 25 }, BANDWIDTH: { rate_kbps: 10 },
};

export function validateParameters(catalog, faultType, input) {
  const entry = catalog?.experiments?.find(item => item.fault_type === faultType);
  if (!entry || !Object.hasOwn(FAULT_LABELS, faultType)) throw new Error('This fault is not in the current allowlisted catalog.');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Fault parameters must be an object.');
  const schema = entry.parameters_schema;
  const fields = schema.properties;
  for (const name of Object.keys(input)) if (!Object.hasOwn(fields, name)) throw new Error(`Unsupported parameter: ${name}`);
  const output = {};
  for (const [name, rule] of Object.entries(fields)) {
    const value = Object.hasOwn(input, name) ? input[name] : rule.default;
    if (value === undefined) {
      if (schema.required?.includes(name)) throw new Error(`Missing parameter: ${name}`);
      continue;
    }
    if (rule.enum && !rule.enum.includes(value)) throw new Error(`Invalid ${name}`);
    if (rule.type === 'string' && typeof value !== 'string') throw new Error(`Invalid ${name}`);
    if (['integer', 'number'].includes(rule.type)) {
      if (typeof value !== 'number' || !Number.isFinite(value) || (rule.type === 'integer' && !Number.isInteger(value))) throw new Error(`${name} must be a finite ${rule.type}.`);
      if ((rule.minimum !== undefined && value < rule.minimum) || (rule.maximum !== undefined && value > rule.maximum) || (rule.exclusiveMinimum !== undefined && value <= rule.exclusiveMinimum)) throw new Error(`${name} is outside the allowed range.`);
    }
    output[name] = value;
  }
  return output;
}

export function buildExperiment(catalog, values) {
  const { duration_seconds, slo_max_error_rate, slo_max_p95_ms } = values;
  const duration = catalog?.duration_seconds;
  if (!duration || !Number.isInteger(duration_seconds) || duration_seconds < duration.minimum || duration_seconds > duration.maximum) throw new Error('Duration is outside the catalog limits.');
  if (!Number.isFinite(slo_max_error_rate) || slo_max_error_rate < 0 || slo_max_error_rate > 1) throw new Error('SLO error rate must be between 0% and 100%.');
  if (!Number.isFinite(slo_max_p95_ms) || slo_max_p95_ms <= 0) throw new Error('SLO P95 must be greater than zero.');
  if (typeof values.name !== 'string' || !values.name.trim() || values.name.trim().length > 255) throw new Error('Provide an experiment name of 1–255 characters.');
  return {
    name: values.name.trim(), fault_type: values.fault_type,
    target_service: catalog.target_service,
    parameters: validateParameters(catalog, values.fault_type, values.parameters),
    duration_seconds, slo_max_error_rate, slo_max_p95_ms,
  };
}

export function buildProposal(catalog, experiment, proposal) {
  if (!proposal) throw new Error('No follow-up experiment was proposed.');
  return buildExperiment(catalog, {
    name: `AI follow-up: ${experiment.name}`.slice(0, 255),
    fault_type: proposal.fault_type, parameters: proposal.suggested_parameters,
    duration_seconds: experiment.parameters?.duration_seconds ?? catalog.duration_seconds.default,
    slo_max_error_rate: experiment.slo_max_error_rate, slo_max_p95_ms: experiment.slo_max_p95_ms,
  });
}
