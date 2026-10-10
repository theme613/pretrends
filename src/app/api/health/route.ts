import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    status: "ok",
    blob_connected: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    vercel: Boolean(process.env.VERCEL),
    timestamp: new Date().toISOString(),
  });
}
