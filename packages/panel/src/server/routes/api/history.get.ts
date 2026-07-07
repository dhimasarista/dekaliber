import { defineEventHandler } from 'h3';
import { listRecentRuns } from '../../utils/storage';

export default defineEventHandler(() => {
  return listRecentRuns(20).map((row) => ({
    id: row.id,
    target: row.target,
    scenario: row.scenario,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    generatorCeilingRps: row.generator_ceiling_rps,
    summary: row.summary_json ? JSON.parse(row.summary_json) : null,
  }));
});
