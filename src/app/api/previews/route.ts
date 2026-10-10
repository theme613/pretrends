import { latestTrends } from "@/lib/scan-store";
import { previewKey, repairPreview } from "@/lib/previews";

export const maxDuration = 60;

export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("key") || "";
  if (!/^[a-f0-9]{64}$/.test(key)) return new Response("Invalid preview", { status: 400 });
  const post = (await latestTrends()).find((post) => previewKey(post) === key);
  if (!post) return new Response("Preview no longer available", { status: 404, headers: { "Cache-Control": "no-store" } });
  try {
    const bytes = await repairPreview(post);
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return new Response("Preview temporarily unavailable", { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "15" } });
  }
}
