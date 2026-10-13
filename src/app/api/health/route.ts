import { NextResponse } from "next/server";

export async function GET() {
  const discovery = Boolean(process.env.APIFY_API_TOKEN?.trim());
  const analysis = Boolean(process.env.GRAFILAB_API_KEY?.trim());
  const cloud = Boolean(process.env.VERCEL);
  const storage = !cloud || Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
  return NextResponse.json(
    {
      status: "ok",
      blob_connected: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
      vercel: Boolean(process.env.VERCEL),
      timestamp: new Date().toISOString(),
      services: {
        discovery,
        analysis,
        storage,
        cloud,
        ready: discovery && analysis && storage,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
