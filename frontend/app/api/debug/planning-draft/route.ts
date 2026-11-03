import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  let payload: unknown = null;

  try {
    payload = await request.json();
  } catch {
    payload = null;
  }

  console.info('[planning-draft] sessionStorage cleared', payload);
  return NextResponse.json({ ok: true });
}
