import { philippinesDateKey } from "./philippinesDate.js";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function getWorkoutDayGroups(sessions) {
  const groups = new Map();

  sessions.forEach((session) => {
    const scheduledDate = philippinesDateKey(session.session_date);
    const scheduleLabel = typeof session.session_date === "string" && session.session_date.trim()
      ? session.session_date.trim().toLowerCase()
      : String(session.day_of_week || "").trim().toLowerCase();
    const completedDate = session.completed
      ? philippinesDateKey(session.completed_at) || (ISO_DATE_PATTERN.test(scheduledDate) ? scheduledDate : "")
      : "";
    const key = ISO_DATE_PATTERN.test(scheduledDate)
      ? scheduledDate
      : scheduleLabel || completedDate;

    if (!key) return;

    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        scheduledDate: ISO_DATE_PATTERN.test(scheduledDate) ? scheduledDate : "",
        completionDate: "",
        isComplete: true,
      };
      groups.set(key, group);
    }

    if (!session.completed) {
      group.isComplete = false;
    } else if (completedDate && completedDate > group.completionDate) {
      group.completionDate = completedDate;
    }
  });

  return [...groups.values()];
}
