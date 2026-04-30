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

    // 원문이 너무 길면 앞 3000자만 사용 (토큰 절약)
    const trimmedText = originalText.length > 3000
      ? originalText.slice(0, 3000) + '\n...(이하 생략)'
      : originalText

    // 3. Claude API: fields + processed_text 함께 요청
    // 두 번 호출 대신 한 번에 받되, processed_text는 원문 그대로 치환자만 삽입
    const fieldsMsg = await anthropic.messages.create({
      model:      'claude-haiku-4-5',
      max_tokens: 8192,
      messages: [{
        role: 'user',
        content: `다음 신청서 원문에서 사용자가 직접 입력해야 할 빈칸을 {{치환자}} 형태로 바꿔줘.

원문:
${trimmedText}

규칙:
1. 빈칸(___), 괄호( ), 날짜 입력란, 선택란 등 사용자가 채워야 할 부분을 {{snake_case_key}} 형태로 교체
2. 치환자 이름은 영문 snake_case만 사용
3. 반드시 아래 JSON 형식만 반환 (코드블록 없이, 설명 없이):
{"processed_text":"치환자가 삽입된 원문 전체","fields":[{"key":"snake_case_key","label":"한국어 레이블","type":"text","required":true}]}

type 규칙: 체크박스/선택지 → "select" + options배열, 여러줄 → "textarea", 날짜 → "date", 나머지 → "text"`
      }]
    })

    const rawFields = fieldsMsg.content.map(b => b.type === 'text' ? b.text : '').join('')
    let cleanFields = rawFields.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    const fs = cleanFields.indexOf('{')
    if (fs === -1) throw new Error('Claude 응답에서 JSON을 찾을 수 없습니다.')
    cleanFields = cleanFields.slice(fs)

    // JSON이 잘렸을 경우 fields 배열까지만 추출 시도
    let parsed: { processed_text?: string; fields: PlaceholderField[] }
    try {
      const fe = cleanFields.lastIndexOf('}')
      parsed = JSON.parse(cleanFields.slice(0, fe + 1))
    } catch {
      // processed_text가 너무 길어서 잘린 경우 → fields 배열만 추출
      const fieldsStart = cleanFields.indexOf('"fields"')
      if (fieldsStart === -1) throw new Error('Claude 응답에서 fields를 찾을 수 없습니다.')
      const arrStart = cleanFields.indexOf('[', fieldsStart)
      if (arrStart === -1) throw new Error('fields 배열을 찾을 수 없습니다.')

      // 완전한 마지막 field 객체까지만 포함
      let depth = 0, lastCompleteEnd = arrStart
      for (let i = arrStart; i < cleanFields.length; i++) {
        if (cleanFields[i] === '{') depth++
        if (cleanFields[i] === '}') {
          depth--
          if (depth === 0) lastCompleteEnd = i + 1
        }
      }
      const fieldsJson = cleanFields.slice(arrStart, lastCompleteEnd) + ']'
      const fields = JSON.parse(fieldsJson) as PlaceholderField[]
      parsed = { fields }
    }

    // processed_text가 없으면 원본 텍스트에서 fields 기반으로 생성
    let processedText = parsed.processed_text || originalText

    // 4. Firestore에 템플릿 저장
    const templateData: Omit<FormTemplate, 'id'> = {
      title,
      originalText,
      processedText:   processedText,
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
