import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { adminDb, adminStorage } from '@/lib/firebase-admin'
import {
  extractTextFromHwpx,
  extractFieldsFromReferenceImages,
  referenceImagesFromFormFiles,
} from '@/lib/hwpx'
import {
  embedPlaceholdersByPdfRulesAuto,
  fieldsFromEmbeddedHwpx,
} from '@/lib/pdf-rules-embed'
import { generatePreviewHtml, summarizeHwpxTables } from '@/lib/preview-html'
import type { FormTemplate, PlaceholderField } from '@/lib/types'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

/** 파일명에서 prefix 추출 (섹션명 fallback) */
function extractPrefix(filename: string, title: string): string {
  const keywords = ['신청서', '결과보고서', '계획서', '보고서', '서식', '동의서', '확인서', '서약서']
  for (const kw of keywords) {
    if (title.includes(kw)) return kw.replace(/서$/, '') || kw
    if (filename.includes(kw)) return kw.replace(/서$/, '') || kw
  }
  return title.replace(/\.[^.]+$/, '').slice(-6) || '문서'
}

/** 비전 필드 메타(레이블·타입)를 자동 삽입 결과에 병합 */
function mergeFieldMetadata(
  autoFields: PlaceholderField[],
  visionFields: PlaceholderField[]
): PlaceholderField[] {
  const byKey = new Map(autoFields.map(f => [f.key, { ...f }]))
  for (const v of visionFields) {
    const existing = byKey.get(v.key)
    if (existing) {
      if (v.label) existing.label = v.label
      if (v.type && v.type !== 'text') existing.type = v.type
      if (v.options?.length) existing.options = v.options
    } else {
      byKey.set(v.key, { ...v, required: false })
    }
  }
  return Array.from(byKey.values())
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

    // PDF 규칙 자동 삽입 (Claude 표별 처리 없음 — 수 초 내 완료)
    let hwpxWithPlaceholders = await embedPlaceholdersByPdfRulesAuto(buffer, prefix)
    let fields = await fieldsFromEmbeddedHwpx(hwpxWithPlaceholders)
    console.log('[upload] PDF 규칙 자동 치환자:', fields.length, '종')

    if (fields.length === 0) {
      return NextResponse.json(
        { error: '입력 칸을 찾지 못했습니다. 표 양식인 hwpx인지 확인해 주세요.' },
        { status: 422 }
      )
    }

    if (refImages.length > 0) {
      try {
        const visionFields = await extractFieldsFromReferenceImages(
          refImages,
          prefix,
          originalText,
          anthropic
        )
        if (visionFields.length > 0) {
          fields = mergeFieldMetadata(fields, visionFields)
          console.log('[upload] 비전 메타 병합 후 fields:', fields.length)
        }
      } catch (e) {
        console.warn('[upload] 비전 메타 병합 실패(자동 삽입 결과는 유지):', e)
      }
    }

    const processedText = await extractTextFromHwpx(hwpxWithPlaceholders)

    let previewHtml: string | undefined
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        const tableSummary = await summarizeHwpxTables(hwpxWithPlaceholders)
        previewHtml = await generatePreviewHtml(anthropic, {
          title,
          processedText,
          tableSummary,
          images: refImages,
        })
        console.log('[upload] AI HTML 미리보기 생성 완료', previewHtml.length, 'chars')
      } catch (e) {
        console.warn('[upload] AI HTML 미리보기 실패 — 휴리스틱 fallback:', e)
      }
    }

    const storagePath = `templates/${Date.now()}_${file.name}`
    const bucket      = adminStorage.bucket()
    const fileRef     = bucket.file(storagePath)
    await fileRef.save(Buffer.from(hwpxWithPlaceholders), {
      metadata: { contentType: 'application/octet-stream' },
    })

    const templateData: Omit<FormTemplate, 'id'> = {
      title,
      originalText,
      processedText,
      fields,
      hwpxStoragePath: storagePath,
      createdAt:       Date.now(),
      ...(previewHtml ? { previewHtml } : {}),
    }

    const docRef = await adminDb.collection('templates').add(templateData)
    return NextResponse.json({ id: docRef.id, ...templateData })

  } catch (err) {
    console.error('[upload] error:', err)
    const msg = err instanceof Error ? err.message : '알 수 없는 오류'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
