"use client";

import { useSyncExternalStore } from "react";
import {
  emptyWorkspace,
  parseWorkspace,
  WORKSPACE_KEY,
  type Workspace,
} from "@/lib/workspace";

type Snapshot = { data: Workspace; ready: boolean; error: string };
const serverSnapshot: Snapshot = {
  data: emptyWorkspace,
  ready: false,
  error: "",
};
let snapshot = serverSnapshot;
let blocked = false;
const listeners = new Set<() => void>();
function publish(next: Snapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}
function read() {
  try {
    const raw = localStorage.getItem(WORKSPACE_KEY);
    const data = raw ? parseWorkspace(JSON.parse(raw)) : emptyWorkspace;
    blocked = false;
    publish({ data, ready: true, error: "" });
  } catch {
    blocked = true;
    publish({
      ...snapshot,
      ready: true,
      error:
        "Browser storage is unavailable or unreadable. Changes will stay in this tab only. Download a backup to keep your work.",
    });
  }
}
function storageChanged(event: StorageEvent) {
  if (event.key === WORKSPACE_KEY || event.key === null) read();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    read();
    window.addEventListener("storage", storageChanged);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) window.removeEventListener("storage", storageChanged);
  };
}
function updateWorkspace(change: (current: Workspace) => Workspace) {
  if (!snapshot.ready) read();
  const data = parseWorkspace(change(snapshot.data));
  let error = snapshot.error;
  if (!blocked) {
    try {
      localStorage.setItem(WORKSPACE_KEY, JSON.stringify(data));
      error = "";
    } catch {
      error =
        "Your browser could not save these changes. Download a backup before closing this tab.";
    }
  }
  publish({ data, ready: true, error });
}
export function useWorkspace() {
  const state = useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => serverSnapshot,
  );
  return { ...state, update: updateWorkspace };
}
