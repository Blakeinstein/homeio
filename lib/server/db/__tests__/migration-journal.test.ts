import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DRIZZLE_ROOT = path.join(import.meta.dirname, "..", "..", "..", "..", "drizzle");

type JournalEntry = { idx: number; when: number; tag: string };

const journal = JSON.parse(
  readFileSync(path.join(DRIZZLE_ROOT, "meta", "_journal.json"), "utf8"),
) as { entries: JournalEntry[] };

/**
 * Shipped before this test existed, and left alone: renumbering a migration
 * that databases have already recorded is riskier than the oddity itself.
 * Nothing may join this list.
 */
const SHIPPED_OUT_OF_ORDER = ["0005_google_drive"];
const SHIPPED_WITHOUT_JOURNAL_ENTRY = [
  "0003_ensure_notifications_scheduled_tasks",
  "0004_task_executions",
];

describe("migration journal", () => {
  // drizzle applies a migration only when its `when` is later than the last
  // one the database has recorded. `db:init` sidesteps that by dropping the
  // record and replaying everything, but `db:migrate` does not: a migration
  // merged in from the 1.9 line kept its 1.9 timestamp, older than every 2.0
  // migration, and that path would have skipped it without a word.
  it("only ever moves forward in time", () => {
    let latest = 0;
    const backwards: string[] = [];
    for (const entry of journal.entries) {
      if (entry.when <= latest && !SHIPPED_OUT_OF_ORDER.includes(entry.tag)) {
        backwards.push(`${entry.tag} (${entry.when} is not after ${latest})`);
      }
      latest = Math.max(latest, entry.when);
    }

    expect(backwards).toEqual([]);
  });

  it("numbers each migration once, in increasing order", () => {
    const indexes = journal.entries.map((entry) => entry.idx);
    const outOfOrder = indexes.filter((idx, position) => position > 0 && idx <= indexes[position - 1]!);

    expect(outOfOrder).toEqual([]);
  });

  it("has a file for every entry and an entry for every file", () => {
    const files = readdirSync(DRIZZLE_ROOT)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => name.replace(/\.sql$/, ""))
      .filter((tag) => !SHIPPED_WITHOUT_JOURNAL_ENTRY.includes(tag))
      .sort();

    expect(journal.entries.map((entry) => entry.tag).sort()).toEqual(files);
  });
});
