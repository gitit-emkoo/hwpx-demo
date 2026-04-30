import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase-admin'

export async function GET() {
  try {
    const snap = await adminDb
      .collection('templates')
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get()

    const templates = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    return NextResponse.json(templates)
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: '목록을 불러올 수 없습니다.' }, { status: 500 })
  }
}
