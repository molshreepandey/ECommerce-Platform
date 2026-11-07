const millisecondsPerHour = 60 * 60 * 1000;
const millisecondsPerDay = 24 * millisecondsPerHour;

function startOfCurrentUtcDay(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export const seedDayStart = startOfCurrentUtcDay();

export function daysFromSeedDay(dayOffset: number): Date {
  return new Date(seedDayStart.getTime() + dayOffset * millisecondsPerDay);
}

export function addHours(timestamp: Date, hours: number): Date {
  return new Date(timestamp.getTime() + hours * millisecondsPerHour);
}
