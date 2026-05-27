import JSZip from 'jszip'
import Anthropic from '@anthropic-ai/sdk'
import type { PlaceholderField } from '@/lib/types'
import { resolvePdfPlaceholder } from '@/lib/pdf-rules-embed'

/**
 * hwpx 파일(Buffer)에서 텍스트 추출 (미리보기용)
 */
export async function extractTextFromHwpx(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer)
  const sectionFiles = getSectionFiles(zip)
  const texts: string[] = []
  for (const fileName of sectionFiles) {
    const file = zip.files[fileName]
    if (!file) continue
    const xmlStr = await file.async('string')
    const text = extractTextFromXml(xmlStr)
    if (text.trim()) texts.push(text)
  }
  return texts.join('\n\n').trim()
}

function getSectionFiles(zip: JSZip): string[] {
  const sections = Object.keys(zip.files).filter(
    name => name.match(/Contents\/section\d+\.xml/i)
  )
  if (sections.length > 0) return sections
  return Object.keys(zip.files).filter(n => n.endsWith('.xml')).slice(0, 3)
}

function extractTextFromXml(xmlStr: string): string {
  const lines: string[] = []
  const paras = xmlStr.split(/<hp:p\b[^>]*>/)
  for (const para of paras) {
    const parts: string[] = []
    const re = /<hp:t[^>]*>([^<]*)<\/hp:t>/g
    let m: RegExpExecArray | null
    while ((m = re.exec(para)) !== null) {
      if (m[1].trim()) parts.push(m[1])
    }
    if (parts.length > 0) lines.push(parts.join(''))
  }
  if (lines.length === 0) {
    return xmlStr.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  }
  return lines.join('\n')
}

// ─────────────────────────────────────────────
// 입력 필드 위치 정보 추출 (표 셀 + 표 바깥 단락)
// ─────────────────────────────────────────────

export interface CellInfo {
  type: 'cell'
  tableIdx: number
  cellIdx: number
  text: string
  isEmpty: boolean
}

export interface ParaInfo {
  type: 'para'
  paraIdx: number     // 전체 단락 순서 (표 제외)
  text: string
  isInputLike: boolean  // 입력란으로 보이는 패턴
}

export type FieldLocation = CellInfo | ParaInfo

/** 입력란으로 보이는 텍스트 패턴 (셀/단락 공통) */
function isInputLike(text: string): boolean {
  // 공백이 4개 이상 연속 (기업명 :             )
  if (/\s{4,}/.test(text)) return true
  // 괄호 안 공백 (       )
  if (/\(\s{2,}\)/.test(text)) return true
  // 날짜 패턴: 년   월   일 (공백 2개 이상)
  if (/[년월일]/.test(text) && /\s{2,}/.test(text)) return true
  // 밑줄 패턴
  if (/__+/.test(text)) return true
  // 레이블: 뒤 공백 패턴 (전화:(    ) 같은)
  if (/[가-힣a-zA-Z]\s*:\s{2,}/.test(text)) return true
  return false
}

/** 레이블 다음 칸·옵션 칸 등: 기존 텍스트를 치환자로 통째로 바꿔도 되는지 */
function shouldReplaceValueCell(rawJoined: string, trimmed: string, labelForField: string): boolean {
  if (!trimmed) return true
  if (trimmed.includes('{{')) return false
  if (isInputLike(rawJoined)) return true
  if (/^[※]/.test(trimmed)) return false
  if (/적어|기재|작성|선택|입력|해당사항|예시|운영\s*시\s*기재|참고\s*사항/.test(trimmed)) return true
  // 비전이 준 레이블과 셀 내용이 같음(지원분야 옵션 한 줄 등) → 그 셀에 치환자
  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase()
  if (norm(trimmed) === norm(labelForField) && trimmed.length >= 8) return true
  // 선택지·부제 한 줄 (중간점·슬래시 등)
  if (trimmed.length >= 8 && trimmed.length <= 90 && /[가-힣]/.test(trimmed) && /[·／/]/.test(trimmed)) return true
  return false
}

/** 통째로 바꾸지 않고 끝에 붙일 때: 비정상적으로 긴 셀은 오매칭 방지로 제외 */
const MAX_APPEND_CELL_TEXT_LEN = 10000

/** 셀 안 마지막 텍스트 run 뒤에 치환자 붙임 (기존 문구 유지). ※·예시·단위(명) 등 그대로 두고 뒤에만 붙임. */
function appendPlaceholderToLastHpTInCell(cellXml: string, ph: string): string | null {
  const re = /<hp:t([^>]*)>([^<]*)<\/hp:t>/g
  let m: RegExpExecArray | null
  let last: RegExpExecArray | null = null
  while ((m = re.exec(cellXml)) !== null) last = m
  if (!last || last.index === undefined) return null
  const tail = last[2]
  const glue = tail.length > 0 && !/\s$/.test(tail) ? ' ' : ''
  const rebuilt = `<hp:t${last[1]}>${tail}${glue}${ph}</hp:t>`
  return cellXml.slice(0, last.index) + rebuilt + cellXml.slice(last.index + last[0].length)
}

/** 주석·안내 문구가 아닌 실제 입력란인지 필터 */
function isNotGuideText(text: string): boolean {
  // ※, *, → 로 시작하는 안내 문구 제외
  if (/^[※\*→＊]/.test(text.trim())) return false
  // 긴 문장(50자 이상)이면서 공백이 많은 경우 본문일 가능성 → 제외
  if (text.length > 50 && !/\(\s{2,}\)/.test(text) && !/\s{4,}/.test(text)) return false
  return true
}

/**
 * hwpx XML에서 표 셀 + 표 바깥 입력 단락 구조를 추출
 */
export async function extractFieldLocations(buffer: Buffer): Promise<FieldLocation[]> {
  const zip = await JSZip.loadAsync(buffer)
  const sectionFiles = getSectionFiles(zip)
  const result: FieldLocation[] = []

  for (const fileName of sectionFiles) {
    const file = zip.files[fileName]
    if (!file) continue
    const xmlStr = await file.async('string')

    // 표와 단락을 문서 순서대로 처리
    // 표를 먼저 마킹한 뒤 나머지 단락 처리
    let tableIdx = 0
    let paraIdx = 0

    // 표 내부 셀 추출
    const tblRegex = /<hp:tbl\b[^>]*>([\s\S]*?)<\/hp:tbl>/g
    let tblMatch: RegExpExecArray | null
    while ((tblMatch = tblRegex.exec(xmlStr)) !== null) {
      const tblInner = tblMatch[1]
      let cellIdx = 0
      const cellRegex = /<hp:tc\b[^>]*>([\s\S]*?)<\/hp:tc>/g
      let cellMatch: RegExpExecArray | null
      while ((cellMatch = cellRegex.exec(tblInner)) !== null) {
        const rawTexts: string[] = []
        const tRe = /<hp:t[^>]*>([^<]*)<\/hp:t>/g
        let tm: RegExpExecArray | null
        while ((tm = tRe.exec(cellMatch[1])) !== null) rawTexts.push(tm[1])
        const rawText = rawTexts.join('')
        const text    = rawText.trim()
        // 빈 셀 또는 입력 패턴 있는 셀(날짜, 괄호, 긴 공백 등) 모두 입력 칸으로 표시
        const isEmpty = text === '' || (isInputLike(rawText) && isNotGuideText(text))
        result.push({ type: 'cell', tableIdx, cellIdx, text, isEmpty })
        cellIdx++
      }
      tableIdx++
    }

    // 표 제거 후 나머지 단락 추출
    const xmlNoTbl = xmlStr.replace(/<hp:tbl\b[\s\S]*?<\/hp:tbl>/g, '')
    const paraRegex = /<hp:p\b[^>]*>([\s\S]*?)<\/hp:p>/g
    let paraMatch: RegExpExecArray | null
    while ((paraMatch = paraRegex.exec(xmlNoTbl)) !== null) {
      const rawTexts: string[] = []
      const tRe = /<hp:t[^>]*>([^<]*)<\/hp:t>/g
      let tm: RegExpExecArray | null
      while ((tm = tRe.exec(paraMatch[1])) !== null) rawTexts.push(tm[1])
      const rawText = rawTexts.join('')
      const text    = rawText.trim()
      if (text && isInputLike(rawText) && isNotGuideText(text)) {
        result.push({ type: 'para', paraIdx, text, isInputLike: true })
      }
      if (text) paraIdx++
    }
  }
  return result
}

/**
 * 필드 위치 정보를 Claude에게 보낼 텍스트 형태로 직렬화
 */
export function serializeFieldLocations(locations: FieldLocation[]): string {
  return locations.map(loc => {
    if (loc.type === 'cell') {
      return `[표${loc.tableIdx}-셀${loc.cellIdx}] ${loc.isEmpty ? '(빈칸)' : loc.text}`
    } else {
      return `[단락${loc.paraIdx}] ${loc.text} ${loc.isInputLike ? '← 입력란 패턴' : ''}`
    }
  }).join('\n')
}

// ─────────────────────────────────────────────
// {{key}} 심기 (업로드 시) — 표 셀 + 단락 모두 처리
// ─────────────────────────────────────────────

export interface PlaceholderPosition {
  type: 'cell'
  tableIdx: number
  cellIdx: number
}
export interface ParaPosition {
  type: 'para'
  paraIdx: number
}
export type PositionMap = Record<string, PlaceholderPosition | ParaPosition>

/**
 * cellMap/paraMap에 따라 해당 위치의 <hp:t>에 {{key}}를 심는다.
 */
export async function embedPlaceholdersByPositionMap(
  buffer: Buffer,
  positionMap: PositionMap
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer)
  const sectionFiles = getSectionFiles(zip)

  for (const fileName of sectionFiles) {
    const file = zip.files[fileName]
    if (!file) continue
    let xmlStr = await file.async('string')

    // ── 표 셀 처리 ──
    let tableIdx = 0
    xmlStr = xmlStr.replace(
      /(<hp:tbl\b[^>]*>)([\s\S]*?)(<\/hp:tbl>)/g,
      (_m: string, open: string, tblInner: string, close: string) => {
        let cellIdx = 0
        const newInner = tblInner.replace(
          /(<hp:tc\b[^>]*>)([\s\S]*?)(<\/hp:tc>)/g,
          (_cm: string, cOpen: string, cInner: string, cClose: string) => {
            const entry = Object.entries(positionMap).find(([, pos]) =>
              pos.type === 'cell' && pos.tableIdx === tableIdx && pos.cellIdx === cellIdx
            )
            cellIdx++
            if (!entry) return `${cOpen}${cInner}${cClose}`
            const key = entry[0]
            let inserted = false
            const newCInner = cInner.replace(
              /(<hp:t[^>]*>)([^<]*)(<\/hp:t>)/,
              (_tm: string, tOpen: string, _tContent: string, tClose: string) => {
                if (inserted) return `${tOpen}${_tContent}${tClose}`
                inserted = true
                return `${tOpen}{{${key}}}${tClose}`
              }
            )
            if (!inserted) {
              return `${cOpen}${cInner.replace(
                /(<hp:p\b[^>]*>)/,
                `$1<hp:run charPrIDRef="0"><hp:t>{{${key}}}</hp:t></hp:run>`
              )}${cClose}`
            }
            return `${cOpen}${newCInner}${cClose}`
          }
        )
        tableIdx++
        return `${open}${newInner}${close}`
      }
    )

    // ── 표 바깥 단락 처리 ──
    // 단락 paraIdx를 순서대로 매기며 대상 단락에 {{key}} 삽입
    let paraIdx = 0
    // 표 부분은 건드리지 않고, 표 사이/바깥의 단락만 처리
    // 전략: 표를 플레이스홀더로 치환 → 단락 처리 → 표 복원
    const tableBlocks: string[] = []
    const xmlWithMarkers = xmlStr.replace(
      /<hp:tbl\b[\s\S]*?<\/hp:tbl>/g,
      (tbl) => { tableBlocks.push(tbl); return `\x00TABLE${tableBlocks.length - 1}\x00` }
    )

    const processedWithMarkers = xmlWithMarkers.replace(
      /(<hp:p\b[^>]*>)([\s\S]*?)(<\/hp:p>)/g,
      (_pm: string, pOpen: string, pInner: string, pClose: string) => {
        // 이 단락의 텍스트
        const texts: string[] = []
        const tRe = /<hp:t[^>]*>([^<]*)<\/hp:t>/g
        let tm: RegExpExecArray | null
        while ((tm = tRe.exec(pInner)) !== null) texts.push(tm[1])
        const text = texts.join('').trim()
        if (!text) return `${pOpen}${pInner}${pClose}`

        const entry = Object.entries(positionMap).find(([, pos]) =>
          pos.type === 'para' && pos.paraIdx === paraIdx
        )
        paraIdx++
        if (!entry) return `${pOpen}${pInner}${pClose}`
        const key = entry[0]

        // 첫 번째 <hp:t>에 {{key}} 추가 (원래 텍스트 뒤에 덧붙임)
        let inserted = false
        const newPInner = pInner.replace(
          /(<hp:t[^>]*>)([^<]*)(<\/hp:t>)/,
          (_tm2: string, tOpen: string, tContent: string, tClose: string) => {
            if (inserted) return `${tOpen}${tContent}${tClose}`
            inserted = true
            return `${tOpen}${tContent}{{${key}}}${tClose}`
          }
        )
        return `${pOpen}${newPInner}${pClose}`
      }
    )

    // 표 복원
    xmlStr = processedWithMarkers.replace(
      /\x00TABLE(\d+)\x00/g,
      (_: string, idx: string) => tableBlocks[parseInt(idx)]
    )

    zip.file(fileName, xmlStr)
  }

  const result = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  return Buffer.from(result)
}

// ─────────────────────────────────────────────
// label 기반으로 XML에 {{key}} 심기 (업로드 시)
// ─────────────────────────────────────────────

/**
 * Claude가 반환한 fields의 label을 XML에서 찾아,
 * 레이블 다음 값 칸(빈 칸·년월일·안내 한 줄·옵션 문구 등)에 {{key}}를 삽입한다.
 * 옵션명이 그대로 들어 있는 셀(지원분야 등)은 레이블과 동일할 때 그 셀 안에 치환한다.
 * 통째로 바꾸지 않는 칸(※ 안내, 단위만 있는 「명」 등)은 기존 글을 유지한 채 마지막 텍스트 run 뒤에 {{key}}를 붙인다.
 */
export async function embedPlaceholdersByLabel(
  buffer: Buffer,
  fields: { key: string; label: string }[]
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer)
  const sectionFiles = getSectionFiles(zip)
  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase()

  for (const fileName of sectionFiles) {
    const file = zip.files[fileName]
    if (!file) continue
    let xmlStr = await file.async('string')

    for (const field of fields) {
      const { key, label } = field
      const placeholder = `{{${key}}}`

      const normLabel = norm(label)

      // ── 전략 1: 표 — 같은 레이블이 여러 곳이면 빈 칸마다 반복 삽입
      for (let round = 0; round < 60; round++) {
        let embeddedRound = false
        const tblRe = /<hp:tbl\b[^>]*>[\s\S]*?<\/hp:tbl>/g
        let tblMatch: RegExpExecArray | null
        while (!embeddedRound && (tblMatch = tblRe.exec(xmlStr)) !== null) {
          const tblFull = tblMatch[0]
          const tblStart = tblMatch.index

          const cells: Array<{ start: number; end: number; text: string; rawJoined: string }> = []
          const cellRe = /<hp:tc\b[^>]*>([\s\S]*?)<\/hp:tc>/g
          let cm: RegExpExecArray | null
          while ((cm = cellRe.exec(tblFull)) !== null) {
            const rawTexts: string[] = []
            const tRe = /<hp:t[^>]*>([^<]*)<\/hp:t>/g
            let tm: RegExpExecArray | null
            while ((tm = tRe.exec(cm[1])) !== null) rawTexts.push(tm[1])
            const rawJoined = rawTexts.join('')
            const absStart = tblStart + cm.index
            const absEnd   = absStart + cm[0].length
            cells.push({
              start: absStart,
              end:   absEnd,
              text:  rawJoined.trim(),
              rawJoined,
            })
          }

          // 레이블 셀만: 텍스트가 레이블과 동일(공백 무시), 이미 {{ 있으면 제외
          let labelIdx = cells.findIndex(
            c =>
              !c.text.includes('{{') &&
              norm(c.text) === normLabel &&
              c.text.length <= label.length + 6
          )
          if (labelIdx === -1) {
            labelIdx = cells.findIndex(
              c =>
                !c.text.includes('{{') &&
                normLabel.length >= 3 &&
                norm(c.text).startsWith(normLabel) &&
                norm(c.text).length <= normLabel.length + 12
            )
          }
          if (labelIdx === -1) continue

          const replaceFirstHpTInCell = (cellXml: string, ph: string): string | null => {
            const tMatch = /<hp:t([^>]*)>([^<]*)<\/hp:t>/.exec(cellXml)
            if (tMatch) {
              return cellXml.slice(0, tMatch.index) +
                `<hp:t${tMatch[1]}>${ph}</hp:t>` +
                cellXml.slice(tMatch.index + tMatch[0].length)
            }
            const pMatch = /<hp:p\b[^>]*>/.exec(cellXml)
            if (!pMatch) return null
            const insertAt = pMatch.index + pMatch[0].length
            return cellXml.slice(0, insertAt) +
              `<hp:run charPrIDRef="0"><hp:t>${ph}</hp:t></hp:run>` +
              cellXml.slice(insertAt)
          }

          // 2열 양식: 값 칸은 레이블 바로 옆 한 칸만
          for (let i = labelIdx + 1; i < labelIdx + 2 && i < cells.length; i++) {
            const targetCell = cells[i]
            const cellXml = xmlStr.slice(targetCell.start, targetCell.end)
            if (cellXml.includes('{{')) continue
            let newCellXml: string | null = null
            if (shouldReplaceValueCell(targetCell.rawJoined, targetCell.text, label)) {
              newCellXml = replaceFirstHpTInCell(cellXml, placeholder)
            } else if (
              targetCell.text.length <= MAX_APPEND_CELL_TEXT_LEN &&
              norm(targetCell.text) !== normLabel
            ) {
              newCellXml =
                appendPlaceholderToLastHpTInCell(cellXml, placeholder) ??
                replaceFirstHpTInCell(cellXml, placeholder)
            }
            if (!newCellXml) continue
            xmlStr = xmlStr.slice(0, targetCell.start) + newCellXml + xmlStr.slice(targetCell.end)
            embeddedRound = true
            break
          }

          // 옵션 한 줄(레이블=값)만 같은 셀에 삽입. 짧은 레이블 칸(기업명 등)에는 붙이지 않음
          if (!embeddedRound) {
            const lc = cells[labelIdx]
            const lxml = xmlStr.slice(lc.start, lc.end)
            const sameCellOption =
              !lxml.includes('{{') &&
              norm(lc.text) === normLabel &&
              lc.text.length >= 8
            if (sameCellOption) {
              const newCellXml = replaceFirstHpTInCell(lxml, placeholder)
              if (newCellXml) {
                xmlStr = xmlStr.slice(0, lc.start) + newCellXml + xmlStr.slice(lc.end)
                embeddedRound = true
              }
            }
          }
        }
        if (!embeddedRound) break
      }

      // ── 전략 2: 표 바깥 단락 (표에서 한 번도 못 심었을 때만)
      if (!xmlStr.includes(placeholder)) {
        let embeddedPara = false
        const paraRe = /<hp:p\b[^>]*>[\s\S]*?<\/hp:p>/g
        let pm: RegExpExecArray | null
        while (!embeddedPara && (pm = paraRe.exec(xmlStr)) !== null) {
          const paraFull = pm[0]
          const beforePara = xmlStr.slice(0, pm.index)
          const openTbls  = (beforePara.match(/<hp:tbl\b/g) || []).length
          const closeTbls = (beforePara.match(/<\/hp:tbl>/g) || []).length
          if (openTbls > closeTbls) continue

          const rawTexts: string[] = []
          const tRe = /<hp:t[^>]*>([^<]*)<\/hp:t>/g
          let tm: RegExpExecArray | null
          while ((tm = tRe.exec(paraFull)) !== null) rawTexts.push(tm[1])
          const paraText = rawTexts.join('').trim()

          if (!norm(paraText).includes(normLabel)) continue
          if (paraText.length > label.length * 3 + 20) continue

          const lastTRe = /<hp:t([^>]*)>([^<]*)<\/hp:t>/g
          let lastTMatch: RegExpExecArray | null
          let lastT: RegExpExecArray | null = null
          while ((lastTMatch = lastTRe.exec(paraFull)) !== null) lastT = lastTMatch
          if (!lastT) continue

          const absInsert = pm.index + lastT.index + `<hp:t${lastT[1]}>${lastT[2]}`.length
          xmlStr = xmlStr.slice(0, absInsert) + placeholder + xmlStr.slice(absInsert)
          embeddedPara = true
        }
      }
    }

    zip.file(fileName, xmlStr)
  }

  const result = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  return Buffer.from(result)
}

/** 참조 이미지 MIME */
export type ReferenceImage = { buffer: Buffer; mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' }

const MAX_REFERENCE_IMAGES = 15
const MAX_REFERENCE_IMAGE_BYTES = 5 * 1024 * 1024

/**
 * 관리자가 올린 참조 이미지(PNG 등)를 Claude 비전으로 분석해 입력 필드 목록 추출.
 * hwpx 텍스트 일부를 함께 주면 레이블을 XML과 맞추기 쉬움.
 */
export async function extractFieldsFromReferenceImages(
  images: ReferenceImage[],
  prefix: string,
  originalTextSnippet: string,
  anthropic: Anthropic
): Promise<PlaceholderField[]> {
  if (images.length === 0) return []

  const blocks: Anthropic.ContentBlockParam[] = [{
    type: 'text',
    text: `아래 이미지는 같은 신청서 양식의 페이지입니다. 순서대로 1페이지, 2페이지… 입니다.
hwpx에서 추출한 텍스트 일부 (항목명 매칭용):
"""
${originalTextSnippet.slice(0, 4500)}
"""

작업:
- 이미지에서 **사람이 직접 적어야 하는 칸**만 찾기 (빈 칸, 년월일 틀, 전화번호 틀, 안내 예시 문구가 있는 칸 등)
- 기관명·사업명·유의사항 본문 등 **고정 텍스트는 필드에서 제외**

규칙:
- key는 "섹션_필드" 형태 (예: 기업개요_기업명, 장비활용계획_장비명). prefix "${prefix}" 는 섹션명 fallback.
- type: text | date | select | checkbox | textarea
- checkbox/select는 options 배열에 선택지 문자열 (hwpx □ 옵션과 동일하게)
- label은 hwpx 항목명과 동일하게

extract_reference_fields 툴로만 응답하세요.`,
  }]

  for (let i = 0; i < images.length; i++) {
    blocks.push({ type: 'text', text: `\n[이미지 ${i + 1}/${images.length}]\n` })
    blocks.push({
      type: 'image',
      source: {
        type:       'base64',
        media_type: images[i].mediaType,
        data:       images[i].buffer.toString('base64'),
      },
    })
  }

  const msg = await anthropic.messages.create({
    model:      'claude-haiku-4-5',
    max_tokens: 8192,
    tools: [{
      name: 'extract_reference_fields',
      description: '참조 이미지에서 사용자 입력 필드 추출',
      input_schema: {
        type: 'object' as const,
        properties: {
          fields: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                key:   { type: 'string' },
                label: { type: 'string' },
                type:  { type: 'string', enum: ['text', 'date', 'select', 'textarea'] },
              },
              required: ['key', 'label', 'type'],
            },
          },
        },
        required: ['fields'],
      },
    }],
    tool_choice: { type: 'tool' as const, name: 'extract_reference_fields' },
    messages: [{ role: 'user', content: blocks }],
  })

  const toolUse = msg.content.find(b => b.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') throw new Error('Claude가 필드 목록을 반환하지 않았습니다.')

  const raw = toolUse.input as { fields: PlaceholderField[] }
  const list = Array.isArray(raw.fields) ? raw.fields : []

  const normalized: PlaceholderField[] = []
  const seen = new Set<string>()
  for (const f of list) {
    let key = (f.key || '').trim()
    if (!key.startsWith(`${prefix}_`)) key = `${prefix}_${key}`
    const label = (f.label || key.replace(`${prefix}_`, '')).trim()
    const row: PlaceholderField = {
      key,
      label,
      type:     (f.type || 'text') as PlaceholderField['type'],
      required: false,
    }
    if (!seen.has(key)) {
      seen.add(key)
      normalized.push(row)
    }
  }
  return normalized
}

/** FormData에서 참조 이미지 파일들을 안전하게 변환 */
export async function referenceImagesFromFormFiles(files: File[]): Promise<ReferenceImage[]> {
  const out: ReferenceImage[] = []
  for (const f of files.slice(0, MAX_REFERENCE_IMAGES)) {
    if (f.size > MAX_REFERENCE_IMAGE_BYTES) continue
    const buf = Buffer.from(await f.arrayBuffer())
    let mediaType: ReferenceImage['mediaType'] = 'image/png'
    if (f.type === 'image/jpeg' || f.type === 'image/jpg') mediaType = 'image/jpeg'
    else if (f.type === 'image/webp') mediaType = 'image/webp'
    else if (f.type === 'image/gif') mediaType = 'image/gif'
    else if (f.type === 'image/png') mediaType = 'image/png'
    out.push({ buffer: buf, mediaType })
  }
  return out
}

// ─────────────────────────────────────────────
// 다운로드 시: {{key}} → 값 replace
// ─────────────────────────────────────────────

function escapeXmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Storage hwpx XML에 심어둔 {{key}} / {{key#select#…}} / {{key#checkbox#…}} / {{key#part#…}} 치환
 * PDF 규칙(치환자규칙설명.pdf): checkbox·select → ☑/☐+라벨, part → 날짜 분할, 그 외 텍스트
 */
export async function applyPlaceholdersToHwpx(
  hwpxBuffer: Buffer,
  values: Record<string, string>,
  _fields?: PlaceholderField[]
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(hwpxBuffer)
  const sectionFiles = getSectionFiles(zip)

  for (const fileName of sectionFiles) {
    const file = zip.files[fileName]
    if (!file) continue
    let xmlStr = await file.async('string')

    const phRe = /\{\{([^}]+)\}\}/g
    const inners = new Set<string>()
    let m: RegExpExecArray | null
    while ((m = phRe.exec(xmlStr)) !== null) inners.add(m[1])

    for (const inner of Array.from(inners)) {
      const token = `{{${inner}}}`
      const out = resolvePdfPlaceholder(inner, values, escapeXmlText)
      xmlStr = xmlStr.split(token).join(out)
    }

    zip.file(fileName, xmlStr)
  }

  const result = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  return Buffer.from(result)
}

// ─────────────────────────────────────────────
// Claude가 표 단위로 XML에 한글 치환자 직접 심기
// ─────────────────────────────────────────────

/**
 * hwpx의 각 표를 Claude에게 보내서 입력 칸에 {{prefix_레이블}} 형태로 직접 심게 한다.
 * 반환값: 치환자가 심어진 hwpx Buffer + 추출된 fields 목록
 */
export async function embedPlaceholdersByClaudePerTable(
  buffer: Buffer,
  prefix: string,
  anthropic: Anthropic
): Promise<{ hwpxBuffer: Buffer; fields: PlaceholderField[] }> {
  const zip = await JSZip.loadAsync(buffer)
  const sectionFiles = getSectionFiles(zip)
  const allFields: PlaceholderField[] = []
  const usedKeys = new Set<string>()

  for (const fileName of sectionFiles) {
    const file = zip.files[fileName]
    if (!file) continue
    let xmlStr = await file.async('string')

    // 표를 순서대로 추출 (뒤에서부터 처리해서 인덱스 변동 방지)
    const tableMatches: Array<{ full: string; start: number; end: number }> = []
    const tblRe = /<hp:tbl\b[^>]*>[\s\S]*?<\/hp:tbl>/g
    let tm: RegExpExecArray | null
    while ((tm = tblRe.exec(xmlStr)) !== null) {
      tableMatches.push({ full: tm[0], start: tm.index, end: tm.index + tm[0].length })
    }

    for (let ti = tableMatches.length - 1; ti >= 0; ti--) {
      const tbl = tableMatches[ti]

      // 헤더/안내문만 있는 순수 설명 표는 스킵 (셀이 3개 이하이고 모두 긴 텍스트)
      const cellRe = /<hp:tc\b[^>]*>([\s\S]*?)<\/hp:tc>/g
      let cm: RegExpExecArray | null
      const cellTexts: string[] = []
      while ((cm = cellRe.exec(tbl.full)) !== null) {
        const tRe = /<hp:t[^>]*>([^<]*)<\/hp:t>/g
        let t2: RegExpExecArray | null
        const parts: string[] = []
        while ((t2 = tRe.exec(cm[1])) !== null) parts.push(t2[1])
        cellTexts.push(parts.join('').trim())
      }
      // 모든 셀이 100자 이상의 긴 텍스트면 설명 표 → 스킵
      const allLongText = cellTexts.every(t => t.length > 100)
      if (allLongText) continue

      // 너무 큰 표는 앞 3000자만
      const tblXml = tbl.full.length > 3000
        ? tbl.full.slice(0, 3000) + '\n<!-- 이하 생략 -->'
        : tbl.full

      let modifiedTbl: string = tbl.full
      let tableFields: PlaceholderField[] = []
      try {
        const msg = await anthropic.messages.create({
          model:      'claude-haiku-4-5',
          max_tokens: 4096,
          tools: [{
            name: 'embed_placeholders',
            description: '표 XML의 입력 칸에 한글 치환자를 심고 field 목록 반환',
            input_schema: {
              type: 'object' as const,
              properties: {
                modifiedXml: { type: 'string' },
                fields: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      key:   { type: 'string' },
                      label: { type: 'string' },
                      type:  { type: 'string', enum: ['text', 'date', 'select', 'textarea'] },
                    },
                    required: ['key', 'label', 'type'],
                  }
                }
              },
              required: ['modifiedXml', 'fields'],
            }
          }],
          tool_choice: { type: 'tool' as const, name: 'embed_placeholders' },
          messages: [{
            role: 'user',
            content: `아래는 hwpx 신청서 표의 XML입니다.
신청자(사람)가 직접 써야 할 칸을 찾아서 치환자를 심어주세요.

[입력 칸 판단 기준]
① 빈 셀 (<hp:t></hp:t> 또는 <hp:t> 없음)
② 형식 가이드 텍스트: "년  월  일", "전화 :  -  -", "부서/직급 : /", "(    )", "___" 등
③ 안내 메시지: "실제 사업을 시작한 년월일을 적어주세요", "해당사항 기재" 등
→ ②③은 해당 <hp:t> 내용 전체를 치환자로 교체

[수정 금지]
- 레이블 셀 (항목명, 제목 등 고정 텍스트)
- 기관명, 사업명 등 문서 고정값
- 안내문/유의사항 (※로 시작하는 긴 문장)

[치환자 규칙]
- 형식: {{${prefix}_한국어레이블}} (예: {{${prefix}_대표자 성명}}, {{${prefix}_사업자번호}})
- 레이블: 인접 셀(왼쪽/위) 텍스트 기반 한국어 2~6글자
- XML 구조(태그) 변경 금지, <hp:t> 내용만 교체
- 입력 칸 셀에 <hp:t>가 여러 개면: 첫 번째 <hp:t>에만 치환자, 나머지 <hp:t>는 내용을 빈 문자열로
- 중복 레이블은 _1, _2 suffix

표 XML:
${tblXml}`
          }]
        })

        const toolUse = msg.content.find(b => b.type === 'tool_use')
        if (!toolUse || toolUse.type !== 'tool_use') continue
        const res = toolUse.input as { modifiedXml: string; fields: Array<{ key: string; label: string; type: string }> }
        if (!res.modifiedXml?.includes('<hp:')) continue

        modifiedTbl = res.modifiedXml
          .replace(/^```xml\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/, '').trim()
        tableFields = (res.fields || []).map(f => {
          // prefix 없이 반환된 경우 강제 추가, 공백/특수문자 정리
          let key = f.key.trim()
          if (!key.startsWith(prefix + '_')) key = `${prefix}_${key}`
          // XML 안의 치환자도 동기화
          if (f.key !== key) {
            modifiedTbl = modifiedTbl.split(`{{${f.key}}}`).join(`{{${key}}}`)
          }
          return {
            key,
            label: f.label,
            type: (f.type || 'text') as PlaceholderField['type'],
            required: false,
          }
        })
      } catch (e) {
        console.warn(`[hwpx] 표${ti} 처리 실패:`, e)
        continue
      }

      // 중복 키: fields 목록에는 한 번만 추가, XML에는 그대로 유지 (여러 곳에 심어도 OK)
      for (const f of tableFields) {
        if (!usedKeys.has(f.key)) {
          usedKeys.add(f.key)
          allFields.push(f)
        }
        // 이미 있는 키라도 XML에서 제거하지 않음 → 다운로드 시 모든 위치에 값 반영
      }

      xmlStr = xmlStr.slice(0, tbl.start) + modifiedTbl + xmlStr.slice(tbl.end)
    }

    zip.file(fileName, xmlStr)
  }

  const finalBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  return { hwpxBuffer: Buffer.from(finalBuffer), fields: allFields }
}
