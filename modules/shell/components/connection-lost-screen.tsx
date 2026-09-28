"use client";

import { useEffect, useRef, useState } from "react";
import type {
  ServerConnectionPhase,
  ServerRuntime,
} from "@/modules/shell/hooks/useServerConnection";

// After this long, restarting Homeio by hand is worth mentioning. Earlier it
// would only worry people during an ordinary restart.
const LONG_WAIT_MS = 45_000;

const RESTART_COMMANDS: Record<Exclude<ServerRuntime, null>, { label: string; command: string }> = {
  host: { label: "Installed with the install script", command: "sudo systemctl restart home-server" },
  docker: { label: "Running in Docker", command: "docker restart homeio" },
};

type ConnectionLostScreenProps = {
  phase: Exclude<ServerConnectionPhase, "online">;
  isBrowserOffline: boolean;
  lostSince: number | null;
  nextCheckAt: number | null;
  isChecking: boolean;
  serverRestarted: boolean;
  runtime: ServerRuntime;
  logoSrc: string;
  onCheckNow: () => void;
};

function formatDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

// The icon set loads its images from the server, which is exactly what is
// missing here, so these few glyphs are drawn inline.
function CheckGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden className={className}>
      <path d="M5 10.5l3.2 3.2L15 6.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function WifiOffGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden className={className}>
      <path
        d="M3 3l14 14M8.4 8.2A8 8 0 0 0 4.3 10.3M1.8 7.6a11.5 11.5 0 0 1 3.3-2.1M11.9 5.1a11.5 11.5 0 0 1 6.3 2.5M14.6 11.1a8 8 0 0 0-1.5-1M7.2 13.2a4 4 0 0 1 5.3-.3M10 16.3h.01"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CopyGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden className={className}>
      <rect x="7" y="7" width="9.5" height="9.5" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M13 4.5A1.5 1.5 0 0 0 11.5 3H5a2 2 0 0 0-2 2v6.5A1.5 1.5 0 0 0 4.5 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function copyWithSelection(text: string) {
  const field = document.createElement("textarea");
  field.value = text;
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(field);
  }
}

// navigator.clipboard is missing on plain http (how Homeio is often opened on
// the LAN) and some browsers refuse it outright, so fall back to the older
// copy command before giving up.
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return copyWithSelection(text);
  }
}

function RestartCommand({ label, command }: { label: string; command: string }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "manual">("idle");
  const commandRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (copyState !== "copied") return;
    const timer = setTimeout(() => setCopyState("idle"), 1_800);
    return () => clearTimeout(timer);
  }, [copyState]);

  const copy = async () => {
    if (await copyText(command)) {
      setCopyState("copied");
      return;
    }
    // Leave the command selected so a plain Ctrl/Cmd+C still works.
    const node = commandRef.current;
    const selection = window.getSelection();
    if (node && selection) {
      const range = document.createRange();
      range.selectNodeContents(node);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    setCopyState("manual");
  };

  return (
    <div className="text-left">
      <p className="mb-1.5 text-[11px] tracking-[0.08em] text-foreground/48 uppercase">{label}</p>
      <div className="flex items-center gap-2 rounded-[var(--system-radius-control)] border border-white/8 bg-black/30 py-1.5 pl-3 pr-1.5">
        <code className="min-w-0 flex-1 truncate font-mono text-[13px] text-foreground/88">
          <span className="select-none text-foreground/38">$ </span>
          <span ref={commandRef}>{command}</span>
        </code>
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-[calc(var(--system-radius-control)-2px)] px-2.5 py-1.5 text-xs text-foreground/70 transition hover:bg-white/8 hover:text-foreground"
          aria-label={`Copy ${command}`}
        >
          {copyState === "copied" ? (
            <CheckGlyph className="size-3.5 text-status-green" />
          ) : (
            <CopyGlyph className="size-3.5" />
          )}
          {copyState === "copied" ? "Copied" : "Copy"}
        </button>
      </div>
      {copyState === "manual" ? (
        <p className="mt-1.5 text-[11px] text-foreground/50" role="status">
          Your browser blocked copying. The command is selected — press Ctrl+C (⌘C on a Mac).
        </p>
      ) : null}
    </div>
  );
}

function getCopy(
  phase: ConnectionLostScreenProps["phase"],
  isBrowserOffline: boolean,
  isLongWait: boolean,
  serverRestarted: boolean,
) {
  if (phase === "restored") {
    return serverRestarted
      ? { title: "Homeio is back", body: "The server restarted. Loading the latest version for you…" }
      : { title: "Back online", body: "Reconnected to Homeio. Everything is where you left it." };
  }
  if (isBrowserOffline) {
    return {
      title: "You're offline",
      body: "This device lost its network connection. Homeio will pick up where you left off as soon as you're back online.",
    };
  }
  if (isLongWait) {
    return {
      title: "Homeio is still unreachable",
      body: "This is taking longer than a normal restart. Homeio keeps trying in the background, and you can also restart it yourself.",
    };
  }
  return {
    title: "Reconnecting to Homeio…",
    body: "The server stopped answering — it may be restarting or updating. Your apps and files are safe, and this page reconnects on its own.",
  };
}

export function ConnectionLostScreen({
  phase,
  isBrowserOffline,
  lostSince,
  nextCheckAt,
  isChecking,
  serverRestarted,
  runtime,
  logoSrc,
  onCheckNow,
}: ConnectionLostScreenProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  const restored = phase === "restored";
  const elapsedMs = lostSince ? now - lostSince : 0;
  const isLongWait = !restored && !isBrowserOffline && elapsedMs >= LONG_WAIT_MS;
  const copy = getCopy(phase, isBrowserOffline, isLongWait, serverRestarted);
  const secondsToNextCheck = nextCheckAt ? Math.max(0, Math.ceil((nextCheckAt - now) / 1_000)) : null;
  const commands = runtime ? [RESTART_COMMANDS[runtime]] : [RESTART_COMMANDS.host, RESTART_COMMANDS.docker];

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="connection-lost-title"
      aria-describedby="connection-lost-body"
      // The desktop stays underneath, blurred, so nothing seems to vanish. The
      // blur sits on this element: on a child, the fading parent would cut it
      // off from the desktop and nothing would be blurred.
      className="animate-homeio-connection-fade-in fixed inset-0 z-[100000] overflow-y-auto bg-background/70 text-white backdrop-blur-3xl"
      data-testid="connection-lost-screen"
    >
      <div className="fixed inset-0 bg-[radial-gradient(circle_at_50%_36%,rgba(56,189,248,0.07)_0%,transparent_38%),radial-gradient(circle_at_50%_100%,rgba(255,96,0,0.12)_0%,transparent_44%)]" />
      <div className="fixed inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(0,0,0,0.14)_52%,rgba(0,0,0,0.42)_100%)]" />

      <div className="relative flex min-h-full items-center justify-center px-4 py-12 sm:px-6">
        <div className="animate-homeio-connection-rise w-full max-w-md text-center">
          <div className="relative mx-auto mb-5 flex size-24 items-center justify-center">
            {!restored
              ? [0, 1.2, 2.4].map((delay) => (
                  <span
                    key={delay}
                    aria-hidden
                    className={`animate-homeio-signal-ripple absolute inset-0 rounded-[var(--system-radius-hero)] border ${
                      isBrowserOffline ? "border-amber-300/35" : "border-sky-300/35"
                    }`}
                    style={{ animationDelay: `${delay}s` }}
                  />
                ))
              : null}
            <div
              className={`system-hero-surface flex size-24 items-center justify-center transition-[box-shadow] duration-700 ${
                restored
                  ? "shadow-[0_0_56px_rgba(74,222,128,0.28)]"
                  : "animate-homeio-breathe-glow"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- a blob URL, fetched before the server went away */}
              <img
                src={logoSrc}
                alt="Homeio"
                width={64}
                height={64}
                className={`relative z-10 size-[3.65rem] transition-[filter,opacity] duration-700 ${
                  restored ? "" : "animate-homeio-breathe opacity-85 saturate-[0.55]"
                }`}
              />
            </div>
            {restored || isBrowserOffline ? (
              <span
                aria-hidden
                className={`animate-homeio-badge-pop absolute -bottom-1.5 -right-1.5 z-20 flex size-8 items-center justify-center rounded-full border-2 border-background/80 ${
                  restored ? "bg-status-green text-black/80" : "bg-amber-400 text-black/75"
                }`}
              >
                {restored ? <CheckGlyph className="size-4" /> : <WifiOffGlyph className="size-4" />}
              </span>
            ) : null}
          </div>

          <div className="system-pill-surface mx-auto mb-4 w-fit px-3 py-1 text-[10px] tracking-[0.24em] text-foreground/58 uppercase">
            {restored ? "Connected" : isBrowserOffline ? "No network" : "Connection lost"}
          </div>

          <p
            id="connection-lost-title"
            className="text-[1.48rem] font-medium tracking-[-0.03em] text-foreground"
            aria-live="polite"
          >
            {copy.title}
          </p>
          <p id="connection-lost-body" className="mx-auto mt-1 max-w-sm text-sm leading-6 text-muted-foreground/78">
            {copy.body}
          </p>

          {!restored ? (
            <div className="mt-6 flex flex-col items-center gap-3">
              <div className="system-pill-surface inline-flex items-center gap-2.5 py-1.5 pl-3 pr-1.5 text-xs text-foreground/70">
                <span className="relative flex size-2">
                  <span
                    className={`absolute inline-flex size-full rounded-full opacity-60 motion-safe:animate-ping ${
                      isBrowserOffline ? "bg-amber-400" : "bg-sky-400"
                    }`}
                  />
                  <span
                    className={`relative inline-flex size-2 rounded-full ${
                      isBrowserOffline ? "bg-amber-400" : "bg-sky-400"
                    }`}
                  />
                </span>
                <span className="tabular-nums">
                  {lostSince ? `Offline for ${formatDuration(elapsedMs)}` : "Offline"}
                  {" · "}
                  {isChecking || secondsToNextCheck === 0
                    ? "checking…"
                    : secondsToNextCheck !== null
                      ? `next try in ${secondsToNextCheck}s`
                      : "waiting"}
                </span>
                <button
                  type="button"
                  onClick={onCheckNow}
                  disabled={isChecking}
                  className="rounded-full bg-white/8 px-2.5 py-1 text-[11px] font-medium text-foreground/85 transition hover:bg-white/14 disabled:opacity-50"
                >
                  Try now
                </button>
              </div>
            </div>
          ) : null}

          {isLongWait ? (
            <div className="system-floating-surface animate-homeio-connection-rise mt-6 space-y-3 p-4 text-left">
              <p className="text-sm font-medium text-foreground/90">Restart Homeio on the server</p>
              {commands.map((entry) => (
                <RestartCommand key={entry.command} label={entry.label} command={entry.command} />
              ))}
              <p className="text-xs leading-5 text-foreground/50">
                If the server itself doesn&apos;t respond, check that the machine is powered on
                and connected to your network.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
