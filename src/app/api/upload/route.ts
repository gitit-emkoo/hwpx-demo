import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { adminDb, adminStorage } from '@/lib/firebase-admin'
import {
  extractTextFromHwpx,
  embedPlaceholdersByClaudePerTable,
  embedPlaceholdersByLabel,
  extractFieldsFromReferenceImages,
  referenceImagesFromFormFiles,
} from '@/lib/hwpx'
import type { FormTemplate, PlaceholderField } from '@/lib/types'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

/** 파일명에서 prefix 추출 */
function extractPrefix(filename: string, title: string): string {
  const keywords = ['신청서', '결과보고서', '계획서', '보고서', '서식', '동의서', '확인서', '서약서']
  for (const kw of keywords) {
    if (title.includes(kw)) return kw
    if (filename.includes(kw)) return kw
  }
  return title.replace(/\.[^.]+$/, '').slice(-6) || '문서'
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file     = formData.get('file') as File | null
    const title    = (formData.get('title') as string) || '신청서'

    if (!file) return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 })

    const arrayBuffer = await file.arrayBuffer()
    const buffer      = Buffer.from(arrayBuffer)

    const originalText = await extractTextFromHwpx(buffer)
    if (!originalText || originalText.length < 10) {
      return NextResponse.json({ error: 'hwpx에서 텍스트를 추출할 수 없습니다.' }, { status: 422 })
    }

    const prefix = extractPrefix(file.name, title)
    console.log('[upload] prefix:', prefix)

    const rawImages = formData.getAll('images').filter((x): x is File => x instanceof File && x.size > 0)
    const refImages = await referenceImagesFromFormFiles(rawImages)
    console.log('[upload] 참조 이미지:', refImages.length, '장')

    let fields: PlaceholderField[]
    let hwpxWithPlaceholders: Buffer

    if (refImages.length > 0) {
      fields = await extractFieldsFromReferenceImages(refImages, prefix, originalText, anthropic)
      console.log('[upload] 비전 필드:', fields.length)
      if (fields.length === 0) {
        const fb = await embedPlaceholdersByClaudePerTable(buffer, prefix, anthropic)
        fields = fb.fields
        hwpxWithPlaceholders = fb.hwpxBuffer
        console.log('[upload] 비전 실패 → 표별 폴백 fields:', fields.length)
      } else {
        hwpxWithPlaceholders = await embedPlaceholdersByLabel(buffer, fields)
      }
    } else {
      const r = await embedPlaceholdersByClaudePerTable(buffer, prefix, anthropic)
      fields = r.fields
      hwpxWithPlaceholders = r.hwpxBuffer
      console.log('[upload] 표별 Claude fields:', fields.length)
    }

    const storagePath = `templates/${Date.now()}_${file.name}`
    const bucket      = adminStorage.bucket()
    const fileRef     = bucket.file(storagePath)
    await fileRef.save(Buffer.from(hwpxWithPlaceholders), {
      metadata: { contentType: 'application/octet-stream' }
    })

    let processedText = originalText
    for (const f of fields) {
      const escaped = f.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      processedText = processedText.replace(
        new RegExp(`(${escaped})([^\\n]*)$`, 'm'),
        `$1$2 {{${f.key}}}`
      )
    }

    const templateData: Omit<FormTemplate, 'id'> = {
      title,
      originalText,
      processedText,
      fields,
      hwpxStoragePath: storagePath,
      createdAt:       Date.now(),
    }

    const docRef = await adminDb.collection('templates').add(templateData)
    return NextResponse.json({ id: docRef.id, ...templateData })

  } catch (err) {
    console.error('[upload] error:', err)
    const msg = err instanceof Error ? err.message : '알 수 없는 오류'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
