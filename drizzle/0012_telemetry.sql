ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "telemetry_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "telemetry_instance_id" text;
