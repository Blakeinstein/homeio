"use client";

import { useUpdateReminder } from "@/modules/system/hooks/useUpdateReminder";

const DOCKER_UPDATE_COMMAND = "docker compose pull && docker compose up -d";

type UpdateReminderBarProps = {
  currentVersion: string | null;
  latestVersion: string;
  canSelfUpdate: boolean;
  isApplying: boolean;
  error: string | null;
  onLater: () => void;
  onDetails: () => void;
  onUpdate: () => void;
};

/** Floating bar above the dock, in the same style as the uninstall confirmation. */
export function UpdateReminderBar({
  currentVersion,
  latestVersion,
  canSelfUpdate,
  isApplying,
  error,
  onLater,
  onDetails,
  onUpdate,
}: UpdateReminderBarProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Homeio update available"
      className="fixed bottom-[5.75rem] left-1/2 z-[140] w-[min(92vw,34rem)] -translate-x-1/2 animate-in fade-in slide-in-from-bottom-2 duration-200"
    >
      <div className="overflow-hidden rounded-[var(--system-radius-control)] border border-glass-border/50 bg-popover/90 shadow-[0_8px_32px_rgba(0,0,0,0.28)] backdrop-blur-2xl">
        {/* On a phone the buttons wrap under the text instead of squeezing it. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <div className="flex min-w-0 flex-1 basis-48 items-center gap-3">
            <span className="size-1.5 shrink-0 rounded-full bg-primary shadow-[0_0_10px_hsl(var(--primary)/0.55)]" />
            <div className="min-w-0">
              <p className="truncate text-sm text-foreground/80">
                Homeio <span className="font-medium text-foreground">{latestVersion}</span> is available
              </p>
              {currentVersion ? (
                <p className="truncate text-xs text-muted-foreground/70">You have {currentVersion}</p>
              ) : null}
            </div>
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onLater}
              disabled={isApplying}
              className="h-8 rounded-[var(--system-radius-control)] border border-glass-border/60 bg-white/5 px-3 text-xs font-medium text-foreground/70 transition-colors hover:bg-white/8 hover:text-foreground disabled:opacity-50"
            >
              Later
            </button>
            <button
              type="button"
              onClick={onDetails}
              disabled={isApplying}
              className="h-8 rounded-[var(--system-radius-control)] border border-glass-border/60 bg-white/5 px-3 text-xs font-medium text-foreground/70 transition-colors hover:bg-white/8 hover:text-foreground disabled:opacity-50"
            >
              Details
            </button>
            {canSelfUpdate ? (
              <button
                type="button"
                onClick={onUpdate}
                disabled={isApplying}
                className="h-8 rounded-[var(--system-radius-control)] border border-primary/25 bg-primary/15 px-3 text-xs font-medium text-primary transition-colors hover:bg-primary/25 disabled:opacity-50"
              >
                {isApplying ? "Starting…" : "Update now"}
              </button>
            ) : null}
          </div>
        </div>

        {!canSelfUpdate ? (
          <div className="border-t border-glass-border/40 px-4 py-2 text-xs text-muted-foreground/80">
            Running in Docker: update from the folder with your compose file with{" "}
            <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-[11px] text-foreground/85">
              {DOCKER_UPDATE_COMMAND}
            </code>
          </div>
        ) : null}

        {error ? (
          <div className="border-t border-glass-border/40 px-4 py-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-status-red/18 bg-black/26 px-3 py-1.5 backdrop-blur-xl">
              <span className="size-1.5 shrink-0 rounded-full bg-status-red shadow-[0_0_10px_rgba(239,68,68,0.45)]" />
              <p className="text-xs tracking-[0.01em] text-status-red/92">{error}</p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

type UpdateReminderProps = {
  /** False while the desktop is locked or in demo mode. */
  enabled: boolean;
  onOpenDetails: () => void;
};

export function UpdateReminder({ enabled, onOpenDetails }: UpdateReminderProps) {
  const reminder = useUpdateReminder({ enabled });

  if (!reminder.visible || !reminder.latestVersion) return null;

  return (
    <UpdateReminderBar
      currentVersion={reminder.currentVersion}
      latestVersion={reminder.latestVersion}
      canSelfUpdate={reminder.canSelfUpdate}
      isApplying={reminder.isApplying}
      error={reminder.error}
      onLater={reminder.later}
      onDetails={() => {
        // Settings → Updates has its own Update button; the bar would only cover it.
        reminder.later();
        onOpenDetails();
      }}
      onUpdate={() => void reminder.update()}
    />
  );
}
