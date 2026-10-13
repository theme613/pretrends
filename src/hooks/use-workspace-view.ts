"use client";
import { useSyncExternalStore } from "react";

export type WorkspaceView = "discover" | "saved" | "planner" | "settings";
const views = new Set(["discover", "saved", "planner", "settings"]);
function subscribe(listener: () => void) {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
}
function getSnapshot(): WorkspaceView {
  const hash = window.location.hash.slice(1);
  return views.has(hash) ? (hash as WorkspaceView) : "discover";
}
export function useWorkspaceView() {
  return useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => "discover" as WorkspaceView,
  );
}
export function navigateWorkspace(view: WorkspaceView) {
  window.history.pushState(null, "", `#${view}`);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  window.scrollTo({ top: 0, behavior: "instant" });
}
