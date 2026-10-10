import { NextResponse } from 'next/server';

export async function GET() {
  const categories = ["Music", "Dance", "Meme", "Car", "Game", "Food", "Fashion", "Sports"];
  return NextResponse.json(categories);
}
