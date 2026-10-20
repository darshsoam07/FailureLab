// Only display explicitly configured relative proxy prefixes; never reveal URL authorities or queries.
export function safeProxyPrefix(value) {
  return typeof value === 'string' && /^\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\/?$/.test(value) ? value : 'Not configured as a relative proxy prefix';
}
export function catalogBounds(catalog) {
  return (catalog?.experiments ?? []).flatMap(item => Object.entries(item.parameters_schema?.properties ?? {}).map(([name, schema]) => ({
    fault: item.fault_type, name,
    limits: schema.enum ? schema.enum.join(', ') : `${schema.minimum ?? schema.exclusiveMinimum ?? 'unspecified'} – ${schema.maximum ?? schema.exclusiveMaximum ?? 'unspecified'}`,
  })));
}
