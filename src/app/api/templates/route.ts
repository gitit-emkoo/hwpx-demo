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
    console.error(err)
    return NextResponse.json({ error: '목록을 불러올 수 없습니다.' }, { status: 500 })
  }
}
