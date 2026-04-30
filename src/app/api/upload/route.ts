import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { adminDb, adminStorage } from '@/lib/firebase-admin'
import { extractTextFromHwpx } from '@/lib/hwpx'
import type { FormTemplate, PlaceholderField } from '@/lib/types'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file     = formData.get('file') as File | null
    const title    = formData.get('title') as string || '신청서'

    if (!file) return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 })

    // 1. hwpx → Buffer → 텍스트 추출
    const arrayBuffer = await file.arrayBuffer()
    const buffer      = Buffer.from(arrayBuffer)
    const originalText = await extractTextFromHwpx(buffer)

    if (!originalText || originalText.length < 10) {
      return NextResponse.json({ error: 'hwpx에서 텍스트를 추출할 수 없습니다. 파일을 확인해 주세요.' }, { status: 422 })
    }

    // 2. Firebase Storage에 원본 hwpx 저장
    const storagePath = `templates/${Date.now()}_${file.name}`
    const bucket      = adminStorage.bucket()
    const fileRef     = bucket.file(storagePath)
    await fileRef.save(buffer, { metadata: { contentType: 'application/octet-stream' } })

    // 3. Claude API로 치환자 분석
    const message = await anthropic.messages.create({
      model:      'claude-opus-4-5',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: `다음 신청서 원문에서 사용자가 직접 입력해야 할 빈칸 부분을 모두 찾아서 {{치환자}} 문법으로 바꿔줘.

원문:
${originalText}

규칙:
1. 빈칸(___), 괄호( ), 날짜 입력란, 선택란 등 사용자가 채워야 할 모든 부분을 치환자로 변환
2. 치환자 이름은 영문 snake_case: 예) {{applicant_name}}, {{birth_date}}, {{department}}
3. 체크박스나 여러 선택지 중 하나를 고르는 경우 type을 "select"로 하고 options 배열 포함
4. 여러 줄 입력이 필요한 경우 type을 "textarea"로
5. 날짜 형식은 type을 "date"로
6. 반드시 JSON만 반환 (마크다운 코드블록 없이, 다른 텍스트 없이 순수 JSON만):
{
  "processed_text": "치환자가 삽입된 전체 문서 텍스트 (원본 형식 최대한 유지)",
  "fields": [
    {
      "key": "치환자키",
      "label": "한국어 레이블",
      "type": "text|date|select|textarea",
      "options": ["선택지1", "선택지2"],
      "required": true
    }
  ]
}`
      }]
    })

    const rawText = message.content.map(b => b.type === 'text' ? b.text : '').join('')

    // 코드블록 제거 후 JSON 객체 부분만 추출
    let clean = rawText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    const jsonStart = clean.indexOf('{')
    const jsonEnd   = clean.lastIndexOf('}')
    if (jsonStart === -1 || jsonEnd === -1) throw new Error('Claude 응답에서 JSON을 찾을 수 없습니다.')
    clean = clean.slice(jsonStart, jsonEnd + 1)

    const parsed  = JSON.parse(clean) as { processed_text: string; fields: PlaceholderField[] }

    // 4. Firestore에 템플릿 저장
    const templateData: Omit<FormTemplate, 'id'> = {
      title,
      originalText,
      processedText:   parsed.processed_text,
      fields:          parsed.fields,
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
