import "server-only";

import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/server/db/drizzle";
import { settings } from "@/lib/server/db/schema";
import type { BackupAgentConfig } from "@/lib/shared/contracts/backup-agent";

async function ensureSettingsRow() {
  await db.execute(sql`
    INSERT INTO settings (id, appearance_json, updated_at)
    VALUES ('singleton', '{}', NOW())
    ON CONFLICT (id) DO NOTHING
  `);
}

function normalize(value: string | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizePort(value: number | undefined) {
  if (value === undefined) return null;
  if (!Number.isInteger(value) || value < 1 || value > 65535) return null;
  return value;
}

export async function getBackupAgentConfig(): Promise<BackupAgentConfig> {
  await ensureSettingsRow();

  const rows = await db
    .select({
      enabled: settings.backupAgentEnabled,
      url: settings.backupAgentUrl,
      port: settings.backupAgentPort,
      configPath: settings.backupAgentConfigPath,
    })
    .from(settings)
    .where(eq(settings.id, "singleton"))
    .limit(1);

  const row = rows[0];
  return {
    enabled: Boolean(row?.enabled),
    url: row?.url ?? null,
    port: row?.port ?? null,
    configPath: row?.configPath ?? null,
  };
}

export async function saveBackupAgentConfig(input: {
  enabled: boolean;
  url?: string;
  port?: number;
  configPath?: string;
}): Promise<BackupAgentConfig> {
  await ensureSettingsRow();

  await db
    .update(settings)
    .set({
      backupAgentEnabled: input.enabled,
      backupAgentUrl: normalize(input.url),
      backupAgentPort: normalizePort(input.port),
      backupAgentConfigPath: normalize(input.configPath),
      updatedAt: new Date(),
    })
    .where(eq(settings.id, "singleton"));

  return getBackupAgentConfig();
}
