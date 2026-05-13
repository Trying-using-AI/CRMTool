export interface WorkerJob {
  type: 'campaign_send' | 'retry_send';
  payload: Record<string, unknown>;
}
export function describeWorkerJob(job: WorkerJob): string {
  return `worker:${job.type}`;
}
