import { defineEventHandler, readBody, getRequestHost, getRequestProtocol, createError } from 'h3';
import { startRun, type RunConfig } from '../../utils/run-manager';

const VALID_SCENARIOS = new Set([
  'create_brutal',
  'read_light',
  'read_heavy',
  'update_brutal',
  'delete_brutal',
  'mixed_crud',
]);

export default defineEventHandler(async (event) => {
  const body = await readBody<Partial<RunConfig>>(event);

  if (!body.scenario || !VALID_SCENARIOS.has(body.scenario)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid scenario' });
  }

  const targetPort = body.target_port === null || body.target_port === undefined ? null : Number(body.target_port);
  if (targetPort !== null && (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid target_port' });
  }

  const config: RunConfig = {
    target_label: targetPort === null ? 'Ceiling check' : String(body.target_label || `port ${targetPort}`),
    target_port: targetPort,
    scenario: body.scenario,
    duration_minutes: Number(body.duration_minutes) || 1,
    warmup_minutes: Number(body.warmup_minutes ?? 0),
    request_interval_ms: Number(body.request_interval_ms) || 100,
    ui_update_interval_ms: Number(body.ui_update_interval_ms) || 750,
    raw_sql_mode: Boolean(body.raw_sql_mode),
  };

  const selfOrigin = `${getRequestProtocol(event)}://${getRequestHost(event)}`;
  const snapshot = startRun(config, selfOrigin);

  return { id: snapshot.id, snapshot };
});
