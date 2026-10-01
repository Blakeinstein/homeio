import { describe, expect, it } from "vitest";
import {
  UPDATE_REMINDER_SNOOZE_MS,
  UPDATE_REMINDER_STORAGE_KEY,
  readUpdateReminderSnooze,
  updateReminderSnoozeRemaining,
  writeUpdateReminderSnooze,
} from "@/lib/desktop/update-reminder";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

describe("update reminder snooze", () => {
  it("snoozes a version for an hour and survives a reload", () => {
    const storage = memoryStorage();
    writeUpdateReminderSnooze(storage, "1.10.1", 1_000);

    const snooze = readUpdateReminderSnooze(storage);
    expect(snooze).toEqual({ version: "1.10.1", snoozedUntil: 1_000 + UPDATE_REMINDER_SNOOZE_MS });
    expect(updateReminderSnoozeRemaining(snooze, "1.10.1", 1_000)).toBe(UPDATE_REMINDER_SNOOZE_MS);
    expect(updateReminderSnoozeRemaining(snooze, "1.10.1", 1_000 + UPDATE_REMINDER_SNOOZE_MS)).toBe(0);
  });

  it("does not hold back a newer version than the one snoozed", () => {
    const snooze = { version: "1.10.1", snoozedUntil: 10_000 };
    expect(updateReminderSnoozeRemaining(snooze, "1.10.2", 0)).toBe(0);
  });

  it("ignores missing or malformed stored values", () => {
    expect(readUpdateReminderSnooze(memoryStorage())).toBeNull();
    expect(readUpdateReminderSnooze(memoryStorage({ [UPDATE_REMINDER_STORAGE_KEY]: "{" }))).toBeNull();
    expect(
      readUpdateReminderSnooze(memoryStorage({ [UPDATE_REMINDER_STORAGE_KEY]: '{"version":1}' })),
    ).toBeNull();
    expect(updateReminderSnoozeRemaining(null, "1.10.1", 0)).toBe(0);
  });

  it("still returns the snooze when storage refuses the write", () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(writeUpdateReminderSnooze(storage, "1.10.1", 0)).toEqual({
      version: "1.10.1",
      snoozedUntil: UPDATE_REMINDER_SNOOZE_MS,
    });
  });
});
