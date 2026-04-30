import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase-admin'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const doc = await adminDb.collection('templates').doc(params.id).get()
    if (!doc.exists) return NextResponse.json({ error: '없는 템플릿입니다.' }, { status: 404 })
    return NextResponse.json({ id: doc.id, ...doc.data() })
  } catch (err) {
    return NextResponse.json({ error: '오류가 발생했습니다.' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json()
    await adminDb.collection('templates').doc(params.id).update(body)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: '수정 실패' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await adminDb.collection('templates').doc(params.id).delete()
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: '삭제 실패' }, { status: 500 })
  }
}
