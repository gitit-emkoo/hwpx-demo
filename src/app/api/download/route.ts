import { NextRequest, NextResponse } from 'next/server'
import { adminDb, adminStorage } from '@/lib/firebase-admin'
import { applyPlaceholdersToHwpx } from '@/lib/hwpx'
import type { FormTemplate } from '@/lib/types'

export async function POST(req: NextRequest) {
  try {
    const { templateId, values, mode } = await req.json() as {
      templateId: string
      values: Record<string, string>
      /** 'template' = Storage hwpx 그대로 ({{치환자}} 유지), 'filled' = 값으로 치환 */
      mode?: 'template' | 'filled'
    }

    // 템플릿 조회
    const doc = await adminDb.collection('templates').doc(templateId).get()
    if (!doc.exists) return NextResponse.json({ error: '템플릿 없음' }, { status: 404 })
    const template = { id: doc.id, ...doc.data() } as FormTemplate

    // Firebase Storage에서 원본 hwpx 다운로드
    const bucket  = adminStorage.bucket()
    const fileRef = bucket.file(template.hwpxStoragePath)
    const [hwpxBuffer] = await fileRef.download()

    const keepPlaceholders = mode === 'template'
    const result = keepPlaceholders
      ? hwpxBuffer
      : await applyPlaceholdersToHwpx(hwpxBuffer, values, template.fields)

    if (!keepPlaceholders) {
      await adminDb.collection('submissions').add({
        templateId,
        values,
        createdAt: Date.now(),
      })
    }

    const suffix = keepPlaceholders ? '_양식_치환자포함' : '_작성완료'
    return new NextResponse(new Uint8Array(result), {
      headers: {
        'Content-Type':        'application/octet-stream',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(template.title + suffix + '.hwpx')}`,
      }
    })

  } catch (err) {
    console.error('[download] error:', err)
    return NextResponse.json({ error: '다운로드 실패' }, { status: 500 })
  }
}
