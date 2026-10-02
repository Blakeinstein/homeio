ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "backup_agent_enabled" boolean;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "backup_agent_url" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "backup_agent_config_path" text;
