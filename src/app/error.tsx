"use client";

import { useEffect } from "react";
import { AlertCircle, RotateCcw } from "lucide-react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Application error:", error);
  }, [error]);

  return (
    <main className="min-h-screen flex items-center justify-center bg-black text-white p-6 font-sans">
      <div className="max-w-md w-full bg-zinc-950 border border-zinc-800 rounded-2xl p-8 text-center shadow-2xl">
        <div className="w-12 h-12 rounded-full bg-amber-500/10 text-amber-500 flex items-center justify-center mx-auto mb-4 border border-amber-500/20">
          <AlertCircle className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-semibold mb-2">Something went wrong</h2>
        <p className="text-sm text-zinc-400 mb-6">
          An error occurred while loading this page. You can reload to retry.
        </p>
        <button
          onClick={() => reset()}
          className="inline-flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-xl bg-white text-black font-medium hover:bg-zinc-200 transition-colors cursor-pointer"
        >
          <RotateCcw className="w-4 h-4" />
          Reload
        </button>
      </div>
    </main>
  );
}
