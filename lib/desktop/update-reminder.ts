export const UPDATE_REMINDER_STORAGE_KEY = "desktop.update-reminder.v1";

/** How long "Later" hides the update reminder before it comes back. */
export const UPDATE_REMINDER_SNOOZE_MS = 60 * 60 * 1000;

export type UpdateReminderSnooze = {
  /** The version the user postponed; a newer one shows straight away. */
  version: string;
  snoozedUntil: number;
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function readUpdateReminderSnooze(storage: StorageLike): UpdateReminderSnooze | null {
  try {
    const raw = storage.getItem(UPDATE_REMINDER_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<UpdateReminderSnooze>;
    if (typeof value.version !== "string" || typeof value.snoozedUntil !== "number") return null;
    return { version: value.version, snoozedUntil: value.snoozedUntil };
  } catch {
    return null;
  }
}

export function writeUpdateReminderSnooze(
  storage: StorageLike,
  version: string,
  now: number,
  durationMs = UPDATE_REMINDER_SNOOZE_MS,
): UpdateReminderSnooze {
  const snooze = { version, snoozedUntil: now + durationMs };
  try {
    storage.setItem(UPDATE_REMINDER_STORAGE_KEY, JSON.stringify(snooze));
  } catch {
    // Private windows and full storage throw; the snooze then lasts until reload.
  }
  return snooze;
}

/** Milliseconds until the reminder may show again for `version`, or 0 if it can show now. */
export function updateReminderSnoozeRemaining(
  snooze: UpdateReminderSnooze | null,
  version: string,
  now: number,
): number {
  if (!snooze || snooze.version !== version) return 0;
  return Math.max(0, snooze.snoozedUntil - now);
}
