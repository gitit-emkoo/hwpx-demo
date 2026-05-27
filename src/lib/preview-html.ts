import JSZip from 'jszip'
import Anthropic from '@anthropic-ai/sdk'
import type { ReferenceImage } from '@/lib/hwpx'

/** hwpx 표 구조 요약 — Claude가 레이아웃 맞출 때 참고 */
export async function summarizeHwpxTables(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer)
  const sections = Object.keys(zip.files).filter(n => n.match(/Contents\/section\d+\.xml/i))
  const lines: string[] = []

  for (const fileName of sections) {
    const xml = await zip.file(fileName)?.async('string')
    if (!xml) continue
    let ti = 0
    const tblRe = /<hp:tbl\b[^>]*>[\s\S]*?<\/hp:tbl>/g
    let tm: RegExpExecArray | null
    while ((tm = tblRe.exec(xml)) !== null) {
      const cells: string[] = []
      const cellRe = /<hp:tc\b[^>]*>([\s\S]*?)<\/hp:tc>/g
      let cm: RegExpExecArray | null
      while ((cm = cellRe.exec(tm[0])) !== null) {
        const texts: string[] = []
        const tRe = /<hp:t[^>]*>([^<]*)<\/hp:t>/g
        let t: RegExpExecArray | null
        while ((t = tRe.exec(cm[1])) !== null) texts.push(t[1])
        cells.push(texts.join('').trim().replace(/\s+/g, ' ').slice(0, 120))
      }
      if (cells.length) {
        lines.push(`[표${ti}] ${cells.length}칸`)
        cells.forEach((c, i) => lines.push(`  [${i}] ${JSON.stringify(c)}`))
        ti++
      }
    }
  }
  return lines.join('\n').slice(0, 12000)
}

function extractPlaceholderTokens(text: string): string[] {
  const tokens = new Set<string>()
  const re = /\{\{([^}]+)\}\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) tokens.add(m[1])
  return Array.from(tokens)
}

/** 「3. 장비 활용 계획」: 3체크박스 + 넓은 작성란 — AI 출력이 어긋나도 치환자·레이아웃 보정 */
export function patchEquipmentPlanPreviewHtml(html: string, processedText: string): string {
  const tokens = extractPlaceholderTokens(processedText)
  const checkboxes = tokens.filter(t => /^장비활용계획_.*#checkbox#/.test(t))
  const planToken =
    tokens.find(t => /^장비활용계획_활용계획/.test(t) && !t.includes('#checkbox#') && !t.includes('#select#')) ||
    tokens.find(t => /^장비활용계획_/.test(t) && !t.includes('#') && !t.includes('#checkbox#'))
  if (checkboxes.length < 2 && !planToken) return html

  const cbHtml = checkboxes
    .map(t => `{{${t}}}`)
    .join('\n        ')
  const planPh = planToken ? `{{${planToken}}}` : '{{장비활용계획_활용계획}}'

  const block = `<table class="form-table form-table--equipment-plan">
  <tr>
    <th colspan="2" class="form-section">3. 장비 활용 계획</th>
  </tr>
  <tr>
    <td class="form-label" style="width:22%">임대 희망 장비<br>(미싱장비)</td>
    <td class="form-value form-checkboxes">
        ${cbHtml}
    </td>
  </tr>
  <tr>
    <td colspan="2" class="form-value form-plan-area">${planPh}</td>
  </tr>
</table>`

  const agreeRe = /신청인은\s+상기와\s+같이/
  if (agreeRe.test(html)) {
    return html.replace(
      /(?:<table[^>]*class="form-table"[^>]*>[\s\S]*?)?3\.\s*장비\s*활용\s*계획[\s\S]*?(?=신청인은\s+상기와\s+같이)/i,
      block
    )
  }
  if (/3\.\s*장비\s*활용\s*계획/i.test(html)) {
    return html.replace(/3\.\s*장비\s*활용\s*계획[\s\S]*?(?=<\/table>|신청인은|$)/i, block)
  }
  return html + block
}

/**
 * 참조 이미지 + hwpx 표 구조 + processedText로 실제 양식에 가까운 HTML 미리보기 생성
 */
export async function generatePreviewHtml(
  anthropic: Anthropic,
  opts: {
    title: string
    processedText: string
    tableSummary: string
    images: ReferenceImage[]
  }
): Promise<string> {
  const placeholders = extractPlaceholderTokens(opts.processedText)
  if (placeholders.length === 0) throw new Error('치환자 없음')

  const phList = placeholders.map(p => `{{${p}}}`).join('\n')

  const blocks: Anthropic.ContentBlockParam[] = [{
    type: 'text',
    text: `한국어 행정/신청서 양식을 웹 미리보기용 HTML로 재현해 주세요.

제목: ${opts.title}

## 반드시 지킬 규칙
1. **레이아웃은 참조 이미지(있으면)와 표 구조 요약을 최우선**으로 맞출 것. 단순 줄바꿈 나열 금지.
2. 표 양식은 \`<table class="form-table">\` 로, 레이블 셀·입력 셀 구분 (border-collapse, 1px solid #333).
3. 치환자 문자열은 아래 목록과 **글자 하나 틀리지 않고 그대로** HTML에 넣을 것 (예: \`{{기업개요_기업명}}\`).
4. 치환자는 입력 칸 안에만 — 레이블(항목명) 텍스트는 고정.
5. 출력은 **HTML fragment만** (<html><body> 없이). 인라인 \`<style>\` 한 블록 허용.
6. 스크립트, onclick, 외부 URL 금지. class 이름은 form-doc, form-title, form-section, form-table, form-label, form-value 사용.
7. 체크박스/라디오 치환자(\`#checkbox#\`, \`#select#\`)는 한 줄에 나란히 배치.
8. **「3. 장비 활용 계획」** (해당 치환자가 있을 때): 표 3행 — (1) 제목 행 (2) 왼쪽 「임대 희망 장비 (미싱장비)」, 오른쪽 **3개 체크박스를 한 셀에** (1·2번 같은 줄, 3번 다음 줄) (3) **colspan=2, min-height 160px** 작성 칸에 활용계획 텍스트 치환자. 체크박스를 표 밖으로 빼지 말 것.

## 표 구조 (hwpx 셀 순서)
"""
${opts.tableSummary}
"""

## processedText (치환자 위치 참고)
"""
${opts.processedText.slice(0, 8000)}
"""

## 반드시 HTML에 포함할 치환자 (${placeholders.length}개, 수정·누락·오타 금지)
${phList}

generate_preview_html 툴로 html 필드를 반환하세요.`,
  }]

  for (let i = 0; i < opts.images.length; i++) {
    blocks.push({ type: 'text', text: `\n[참조 이미지 ${i + 1}/${opts.images.length}]\n` })
    blocks.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: opts.images[i].mediaType,
        data: opts.images[i].buffer.toString('base64'),
      },
    })
  }

  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 16000,
    tools: [{
      name: 'generate_preview_html',
      description: '신청서 미리보기 HTML',
      input_schema: {
        type: 'object' as const,
        properties: {
          html: { type: 'string', description: 'HTML fragment with exact {{placeholders}}' },
        },
        required: ['html'],
      },
    }],
    tool_choice: { type: 'tool' as const, name: 'generate_preview_html' },
    messages: [{ role: 'user', content: blocks }],
  })

  const toolUse = msg.content.find(b => b.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') throw new Error('HTML 미리보기 생성 실패')

  let html = (toolUse.input as { html: string }).html?.trim() || ''
  html = html.replace(/^```html\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim()

  // 누락된 치환자가 있으면 실패로 간주하지 않고 경고만 (부분 성공 허용)
  const missing = placeholders.filter(p => !html.includes(`{{${p}}}`))
  if (missing.length > placeholders.length * 0.3) {
    throw new Error(`HTML에 치환자가 너무 많이 누락됨 (${missing.length}/${placeholders.length})`)
  }

  return patchEquipmentPlanPreviewHtml(html, opts.processedText)
}
