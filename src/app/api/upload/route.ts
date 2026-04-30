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

    // 3-A. Claude API: fields 목록만 요청 (응답 크기 최소화)
    const fieldsMsg = await anthropic.messages.create({
      model:      'claude-haiku-4-5',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: `다음 신청서 원문에서 사용자가 직접 입력해야 할 빈칸을 모두 찾아줘.

원문:
${trimmedText}

규칙:
1. 빈칸(___), 괄호( ), 날짜 입력란, 선택란 등 사용자가 채워야 할 부분을 치환자로 정의
2. 치환자 이름은 영문 snake_case: 예) applicant_name, birth_date, department
3. 체크박스/선택지는 type "select"로 하고 options 배열 포함
4. 여러 줄 입력은 type "textarea", 날짜는 type "date", 나머지는 "text"
5. 반드시 아래 JSON 형식만 반환 (코드블록 없이, 설명 없이):
{"fields":[{"key":"snake_case_key","label":"한국어 레이블","type":"text","required":true}]}`
      }]
    })

    const rawFields = fieldsMsg.content.map(b => b.type === 'text' ? b.text : '').join('')
    let cleanFields = rawFields.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    const fs = cleanFields.indexOf('{')
    const fe = cleanFields.lastIndexOf('}')
    if (fs === -1 || fe === -1) throw new Error('Claude 응답에서 JSON을 찾을 수 없습니다.')
    cleanFields = cleanFields.slice(fs, fe + 1)
    const parsed = JSON.parse(cleanFields) as { fields: PlaceholderField[] }

    // 3-B. processed_text: 원본에서 빈칸 패턴을 치환자로 교체
    let processedText = originalText
    // 각 field의 label을 힌트로 빈칸(___) 순서대로 치환자 삽입
    let blankIdx = 0
    processedText = processedText.replace(/_{2,}|(\(\s*\))/g, () => {
      const field = parsed.fields[blankIdx]
      blankIdx++
      return field ? `{{${field.key}}}` : '{{value}}'
    })

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
