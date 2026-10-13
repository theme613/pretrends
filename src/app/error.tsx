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
    <main className="min-h-screen flex items-center justify-center bg-[#fbfaf8] text-[#302a37] p-6 font-sans">
      <div className="max-w-md w-full bg-[#fffefd] border border-[#e8e1ee] rounded-2xl p-8 text-center">
        <div className="w-12 h-12 rounded-full bg-[#f0e8f5] text-[#887198] flex items-center justify-center mx-auto mb-4">
          <AlertCircle className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-medium mb-2">
          Let’s give that another try.
        </h2>
        <p className="text-sm text-[#87778f] leading-relaxed mb-6">
          Your workspace couldn’t load this time. Try again to get back to your
          ideas.
        </p>
        <button
          onClick={() => reset()}
          className="inline-flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-lg bg-[#77628e] text-white font-medium hover:bg-[#665079] transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#77628e]"
        >
          <RotateCcw className="w-4 h-4" />
          Try again
        </button>
      </div>
    </main>
  );
}
