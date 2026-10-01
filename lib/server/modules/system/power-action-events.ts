import "server-only";

import type {
  SystemPowerAction,
  SystemPowerActionEvent,
} from "@/lib/shared/contracts/system";

type PowerActionSubscriber = (event: SystemPowerActionEvent) => void;

declare global {
  var __homeioPowerActionSubscribers: Set<PowerActionSubscriber> | undefined;
}

// The routes that start an action and the stream route can each get their own
// copy of this module, so the subscribers live on globalThis.
const subscribers = (globalThis.__homeioPowerActionSubscribers ??= new Set());

export function subscribeToPowerActions(callback: PowerActionSubscriber): () => void {
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}

// Called once the action is scheduled. Every script waits a couple of seconds
// before it stops Homeio, which leaves time for this to reach open streams.
export function emitPowerAction(action: SystemPowerAction) {
  const event: SystemPowerActionEvent = { action, startedAt: new Date().toISOString() };
  for (const subscriber of subscribers) {
    subscriber(event);
  }
}
