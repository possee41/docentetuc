// Offline capacity model; does not import a runner, credentials or network client.
import { pathToFileURL } from "node:url";

export const fdciScheduleScenarios = [
  { name: "2 cada 2 h", batch: 2, intervalHours: 2 },
  { name: "2 cada 1 h", batch: 2, intervalHours: 1 },
  { name: "3 cada 2 h", batch: 3, intervalHours: 2 },
];

export function projectFdciSchedule(count, { batch, intervalHours }, lostPercent = 25, retryPercent = 20) {
  if (!Number.isSafeInteger(count) || count < 0 || !Number.isInteger(batch) || batch < 1 || batch > 3 ||
      ![1, 2].includes(intervalHours) || !Number.isInteger(lostPercent) || lostPercent < 0 || lostPercent >= 100 ||
      !Number.isInteger(retryPercent) || retryPercent < 0 || retryPercent > 100)
    throw new Error("SIMULATION_INPUT_INVALID");
  const dailySlots = 24 / intervalHours;
  const productiveSlots = Math.floor(dailySlots * (100 - lostPercent) / 100);
  const work = Math.ceil(count * (100 + retryPercent) / 100);
  const productiveJobs = Math.ceil(work / batch);
  const requiredSlots = Math.ceil(productiveJobs * 100 / (100 - lostPercent));
  const jobsPerMonth = dailySlots * 30;
  return {
    count, batch, intervalHours, lostPercent, retryPercent, dailySlots,
    nominalDailyRecords: dailySlots * batch,
    dailyRecordsWithReserve: Math.floor(productiveSlots * batch * 100 / (100 + retryPercent)),
    nominalCycleHours: Math.ceil(count / batch) * intervalHours,
    reservedCycleHours: requiredSlots * intervalHours,
    reservedWorkUnits: work, productiveJobs, requiredSlots,
    fits24HoursWithReserve: requiredSlots <= dailySlots,
    jobsPerMonth, monthlyMinutesAtTwoMinutes: jobsPerMonth * 2,
    monthlyPrivateLinuxComputeUsdAtTwoMinutes: Number((jobsPerMonth * 2 * 0.006).toFixed(2)),
    // Explicit planning envelope, not measured production usage.
    dailyGatewayRequestsBudget: dailySlots * 20,
    dailyD1ReadBudget: dailySlots * 200,
    dailyD1WriteBudget: dailySlots * 100,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(JSON.stringify({ simulationOnly: true, automaticLimitsChanged: false,
    note: "25% lost slots and 20% extra work are planning assumptions, not automatic retries or guaranteed scheduler behavior.",
    rows: [30, 100, 500, 1000].flatMap(count => fdciScheduleScenarios.map(s => ({ name: s.name, ...projectFdciSchedule(count, s) }))),
  }, null, 2));
