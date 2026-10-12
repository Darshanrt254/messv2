import cron from "node-cron";
import { finalizeLunchForDate, finalizeDinnerForDate } from "../services/dailyFinalizationService.js";
import { getNow, getISTComponents } from "../utils/businessTime.js";

let lunchTask = null;
let dinnerTask = null;
let isRunning = false;

/**
 * Starts the daily automation scheduler with Asia/Kolkata timezone.
 *
 * Schedules:
 * 1. Lunch Finalization at 14:00 IST (0 14 * * *)
 * 2. Dinner Finalization at 21:00 IST (0 21 * * *)
 */
export function startDailyScheduler() {
  if (isRunning) {
    console.log("ℹ️  Daily scheduler is already running.");
    return;
  }

  // 1. 2:00 PM IST Lunch finalization
  lunchTask = cron.schedule(
    "0 14 * * *",
    async () => {
      const ist = getISTComponents();
      console.log(`⏰ [Scheduler] Triggering 2:00 PM IST Lunch Finalization for ${ist.dateString}...`);
      try {
        const summary = await finalizeLunchForDate(getNow());
        console.log("✅ [Scheduler] Lunch finalization complete:", JSON.stringify(summary));
      } catch (error) {
        console.error("❌ [Scheduler] Error during Lunch finalization:", error);
      }
    },
    {
      scheduled: true,
      timezone: "Asia/Kolkata",
    }
  );

  // 2. 9:00 PM IST Dinner finalization
  dinnerTask = cron.schedule(
    "0 21 * * *",
    async () => {
      const ist = getISTComponents();
      console.log(`⏰ [Scheduler] Triggering 9:00 PM IST Dinner Finalization for ${ist.dateString}...`);
      try {
        const summary = await finalizeDinnerForDate(getNow());
        console.log("✅ [Scheduler] Dinner finalization complete:", JSON.stringify(summary));
      } catch (error) {
        console.error("❌ [Scheduler] Error during Dinner finalization:", error);
      }
    },
    {
      scheduled: true,
      timezone: "Asia/Kolkata",
    }
  );

  isRunning = true;
  console.log("🕒 Daily Scheduler started successfully (Timezone: Asia/Kolkata).");
  console.log("   - 2:00 PM IST: Lunch finalization");
  console.log("   - 9:00 PM IST: Dinner finalization");
}

/**
 * Stops the daily automation scheduler.
 */
export function stopDailyScheduler() {
  if (lunchTask) {
    lunchTask.stop();
    lunchTask = null;
  }
  if (dinnerTask) {
    dinnerTask.stop();
    dinnerTask = null;
  }
  isRunning = false;
  console.log("🛑 Daily Scheduler stopped.");
}

/**
 * Returns current scheduler status.
 */
export function getSchedulerStatus() {
  return {
    isRunning,
    timezone: "Asia/Kolkata",
    jobs: [
      { name: "LUNCH_FINALIZATION", cron: "0 16 * * *", description: "4:00 PM IST Lunch Processing" },
      { name: "DINNER_FINALIZATION", cron: "0 23 * * *", description: "11:00 PM IST Dinner Processing" },
    ],
  };
}
