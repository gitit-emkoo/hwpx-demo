import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase-admin'

export async function GET() {
  try {
    const snap = await adminDb
      .collection('templates')
      .limit(20)
      .get()

    const templates = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a: any, b: any) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
    return NextResponse.json(templates)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[templates] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
