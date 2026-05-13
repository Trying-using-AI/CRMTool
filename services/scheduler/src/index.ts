export interface ScheduledJob {
  id: string;
  runAt: string;
  queue: 'campaigns' | 'retries';
}
export function dueJobs(nowIso: string, jobs: ScheduledJob[]): ScheduledJob[] {
  return jobs.filter((job) => job.runAt <= nowIso);
}
