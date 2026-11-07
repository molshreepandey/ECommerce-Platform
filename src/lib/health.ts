export type DependencyName = 'postgres' | 'elasticsearch' | 'redis';
export type DependencyStatus = 'up' | 'down';
export type OverallHealthStatus = 'ok' | 'degraded' | 'unavailable';

export const criticalDependencies: Record<DependencyName, boolean> = {
  postgres: true,
  elasticsearch: false,
  redis: false,
};

export interface DependencyReport {
  status: DependencyStatus;
  critical: boolean;
}

export interface HealthReport {
  status: OverallHealthStatus;
  httpStatus: 200 | 503;
  checks: Record<DependencyName, DependencyReport>;
}

function buildDependencyReport(
  name: DependencyName,
  dependencyStatuses: Record<DependencyName, DependencyStatus>,
): DependencyReport {
  return { status: dependencyStatuses[name], critical: criticalDependencies[name] };
}

export function summarizeHealth(
  dependencyStatuses: Record<DependencyName, DependencyStatus>,
): HealthReport {
  const checks: Record<DependencyName, DependencyReport> = {
    postgres: buildDependencyReport('postgres', dependencyStatuses),
    elasticsearch: buildDependencyReport('elasticsearch', dependencyStatuses),
    redis: buildDependencyReport('redis', dependencyStatuses),
  };
  const downReports = Object.values(checks).filter((report) => report.status === 'down');
  if (downReports.some((report) => report.critical)) {
    return { status: 'unavailable', httpStatus: 503, checks };
  }
  if (downReports.length > 0) return { status: 'degraded', httpStatus: 200, checks };
  return { status: 'ok', httpStatus: 200, checks };
}

export async function probeWithTimeout(
  probe: () => Promise<boolean>,
  timeoutMilliseconds: number,
): Promise<DependencyStatus> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timeoutHandle = setTimeout(() => {
      resolve(false);
    }, timeoutMilliseconds);
  });
  try {
    return (await Promise.race([probe(), timeout])) ? 'up' : 'down';
  } catch {
    return 'down';
  } finally {
    clearTimeout(timeoutHandle);
  }
}
