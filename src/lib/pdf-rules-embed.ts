import JSZip from 'jszip'
import type { PlaceholderField } from '@/lib/types'
import {
  fieldsFromPlaceholderInners,
  parsePlaceholderInner,
} from '@/lib/placeholder-fields'

export { parsePlaceholderInner, fieldsFromPlaceholderInners, fieldsFromProcessedText, extractInnersFromProcessedText } from '@/lib/placeholder-fields'

const HWPX_CHECKED = '\u2611'
const HWPX_UNCHECKED = '\u2610'

function getSectionFiles(zip: JSZip): string[] {
  const sections = Object.keys(zip.files).filter(n => n.match(/Contents\/section\d+\.xml/i))
  if (sections.length > 0) return sections
  return Object.keys(zip.files).filter(n => n.endsWith('.xml')).slice(0, 3)
}

export function ph(inner: string): string {
  return `{{${inner}}}`
}

function norm(s: string): string {
  return s.replace(/\s+/g, '').toLowerCase()
}

function labelToKeyPart(label: string): string {
  const t = label.replace(/\s+/g, '').replace(/[^\w가-힣()]/g, '').trim()
  return t.slice(0, 36) || '필드'
}

function isInputLike(text: string): boolean {
  if (!text.trim()) return true
  if (/\s{4,}/.test(text)) return true
  if (/\(\s{2,}\)/.test(text)) return true
  if (/[년월일]/.test(text) && /\s{2,}/.test(text)) return true
  if (/__+/.test(text)) return true
  if (/[가-힣a-zA-Z]\s*:\s{2,}/.test(text)) return true
  if (/^[-\s@]+$/.test(text.trim())) return true
  return false
}

function isGuideOrBody(text: string): boolean {
  if (text.length > 100) return true
  if (/^[※]/.test(text.trim())) return true
  if (/신청하며|동의합니다|귀하|첨부서|유의사항/.test(text)) return true
  return false
}

function parseCheckboxOptions(text: string): string[] {
  const opts: string[] = []
  const re = /□\s*([^□]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const o = m[1].trim()
    if (o) opts.push(o)
  }
  return opts
}

function isSelectOptions(options: string[]): boolean {
  if (options.some(o => /동의/.test(o))) return true
  if (options.length <= 3 && options.every(o => o.length <= 6)) return true
  return false
}

/** "년   월   일" 입력 틀만 (「생년월일」항목명 제외) */
function isCombinedDateCell(rawJoined: string): boolean {
  if (/년\s+월\s+일/.test(rawJoined)) return true
  if (/년\s{2,}.*월\s{2,}.*일/.test(rawJoined)) return true
  return false
}

function inferSectionKey(text: string, fallback: string): string {
  const t = text.trim()
  if (/기업\s*개요/i.test(t) && t.length < 30) return '기업개요'
  if ((/^\d*\.?\s*대표자\s*정보/i.test(t) || t === '대표자 정보') && t.length < 35) return '대표자정보'
  if ((/^\d*\.?\s*장비/i.test(t) || /장비\s*활용/i.test(t)) && t.length < 40) return '장비활용계획'
  if (/개인정보|동의서/i.test(t) && t.length < 50) return '개인정보'
  if (/업\s*체\s*명|대표자성명/i.test(t) && t.length < 20) return '서약'
  if (/^[\d.]+\s*\S{2,28}$/.test(t) && !t.includes('□')) {
    return labelToKeyPart(t.replace(/^[\d.]+\s*/, ''))
  }
  return fallback
}

/** 셀에 치환자 텍스트 넣기 (빈 run·hp:t 없음 셀 포함) */
export function setCellPlaceholderText(cellXml: string, text: string): string {
  const tMatch = /<hp:t[^>]*>[^<]*<\/hp:t>/.exec(cellXml)
  if (tMatch) {
    return cellXml.replace(
      /(<hp:t[^>]*>)([^<]*)(<\/hp:t>)/,
      (_m, o: string, _c: string, cl: string) => `${o}${text}${cl}`
    )
  }
  const runSelfClose = /<hp:run\b[^>]*\/>/.exec(cellXml)
  if (runSelfClose) {
    const ins = runSelfClose[0].replace(/\/>$/, `><hp:t>${text}</hp:t></hp:run>`)
    return cellXml.slice(0, runSelfClose.index) + ins + cellXml.slice(runSelfClose.index + runSelfClose[0].length)
  }
  const pMatch = /<hp:p\b[^>]*>/.exec(cellXml)
  if (pMatch) {
    const insertAt = pMatch.index + pMatch[0].length
    return (
      cellXml.slice(0, insertAt) +
      `<hp:run charPrIDRef="0"><hp:t>${text}</hp:t></hp:run>` +
      cellXml.slice(insertAt)
    )
  }
  return cellXml
}

/** 여러 hp:t run에 나뉜 셀을 한 줄 텍스트로 합친 뒤 치환자 문자열로 교체 */
function collapseCellText(cellXml: string, newText: string): string {
  const { rawJoined } = getCellText(cellXml)
  if (!rawJoined.trim() && !/<hp:t/.test(cellXml)) {
    return setCellPlaceholderText(cellXml, newText)
  }
  let first = true
  let replaced = false
  const xml = cellXml.replace(/<hp:t[^>]*>[^<]*<\/hp:t>/g, () => {
    replaced = true
    if (first) {
      first = false
      return `<hp:t>${newText}</hp:t>`
    }
    return '<hp:t></hp:t>'
  })
  return replaced ? xml : setCellPlaceholderText(cellXml, newText)
}

export function embedCheckboxLine(cellXml: string, baseKey: string, options: string[]): string {
  let line = getCellText(cellXml).rawJoined
  for (const opt of options) {
    const token = ph(`${baseKey}#checkbox#${opt}`)
    line = line.split(`□${opt}`).join(token)
    line = line.split(`□ ${opt}`).join(token)
  }
  if (line.includes('□')) {
    line = line.replace(/□\s*([^□]+)/g, (_m, opt: string) => {
      const t = opt.trim()
      return t ? ph(`${baseKey}#checkbox#${t}`) : _m
    })
  }
  return collapseCellText(cellXml, line)
}

export function embedSelectLine(cellXml: string, baseKey: string, options: string[]): string {
  let xml = cellXml
  for (const opt of options) {
    const token = ph(`${baseKey}#select#${opt}`)
    xml = xml.split(`□${opt}`).join(token)
    xml = xml.split(`□ ${opt}`).join(token)
  }
  return xml
}

function datePartsText(baseKey: string): string {
  return `${ph(`${baseKey}#part#년#1`)}    ${ph(`${baseKey}#part#월#2`)}   ${ph(`${baseKey}#part#일#3`)}`
}

function uniqueKey(base: string, used: Map<string, number>): string {
  const n = used.get(base) || 0
  used.set(base, n + 1)
  return n === 0 ? base : `${base}_${n + 1}`
}

interface CellSnap {
  text: string
  rawJoined: string
  inner: string
}

function getCellText(cellInner: string): { text: string; rawJoined: string } {
  const rawTexts: string[] = []
  const tRe = /<hp:t[^>]*>([^<]*)<\/hp:t>/g
  let tm: RegExpExecArray | null
  while ((tm = tRe.exec(cellInner)) !== null) rawTexts.push(tm[1])
  const rawJoined = rawTexts.join('')
  return { text: rawJoined.trim(), rawJoined }
}

function isDateOnlyTable(cells: CellSnap[]): boolean {
  if (cells.length !== 3) return false
  const t = cells.map(c => c.text.trim())
  return (t[0].includes('년') || t[0] === '') && (t[1] === '월' || t[1].includes('월')) && (t[2] === '일' || t[2].includes('일'))
}

function processTableCells(
  cells: CellSnap[],
  defaultSection: string,
  usedKeys: Map<string, number>
): CellSnap[] {
  let section = defaultSection
  let lastLabel = ''
  let splitDateBase: string | null = null

  if (isDateOnlyTable(cells)) {
    section = '기본'
    lastLabel = '작성일'
  }

  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]
    if (c.text.includes('{{')) continue
    if (isGuideOrBody(c.text)) continue

    const sec = inferSectionKey(c.text, section)
    if (sec !== section && c.text.length < 45 && !c.text.includes('□')) {
      section = sec
      if (c.text.length < 25) continue
    }

    const options = parseCheckboxOptions(c.text)
    if (options.length >= 2) {
      const labelPart = lastLabel ? labelToKeyPart(lastLabel) : '선택'
      const base = uniqueKey(`${section}_${labelPart}`, usedKeys)
      const inner = isSelectOptions(options)
        ? embedSelectLine(c.inner, base, options)
        : embedCheckboxLine(c.inner, base, options)
      cells[i] = { ...c, inner, text: getCellText(inner).text }
      if (section === '장비활용계획') {
        lastLabel = '활용계획'
      } else {
        lastLabel = ''
      }
      splitDateBase = null
      continue
    }

    // 「3. 장비 활용 계획」: 체크박스 행 바로 아래 빈 셀 = 활용 계획 작성란
    if (
      section === '장비활용계획' &&
      c.text === '' &&
      !c.inner.includes('{{') &&
      i > 0 &&
      (/#checkbox#/.test(cells[i - 1].inner) || /□/.test(cells[i - 1].text))
    ) {
      const base = uniqueKey(`${section}_활용계획`, usedKeys)
      const inner = setCellPlaceholderText(c.inner, ph(base))
      cells[i] = { ...c, inner, text: getCellText(inner).text }
      lastLabel = ''
      splitDateBase = null
      continue
    }

    if (isCombinedDateCell(c.rawJoined) && c.text.length < 35) {
      const labelPart = lastLabel ? labelToKeyPart(lastLabel) : '작성일'
      const base = uniqueKey(`${section}_${labelPart}`, usedKeys)
      const inner = setCellPlaceholderText(c.inner, datePartsText(base))
      cells[i] = { ...c, inner, text: getCellText(inner).text }
      splitDateBase = null
      continue
    }

    const t = c.text.trim()
    const dateSection = isDateOnlyTable(cells) ? '기본' : section
    if (/^\d{0,4}\s*년\s*$/.test(t) || t === '년' || /^년$/.test(norm(t))) {
      const base: string = splitDateBase ?? uniqueKey(`${dateSection}_${lastLabel ? labelToKeyPart(lastLabel) : '작성일'}`, usedKeys)
      splitDateBase = base
      const inner = setCellPlaceholderText(c.inner, `${ph(`${base}#part#년#1`)}년`)
      cells[i] = { ...c, inner, text: getCellText(inner).text }
      continue
    }
    if (t === '월' || /^\s*월\s*$/.test(t)) {
      const base: string = splitDateBase ?? uniqueKey(`${dateSection}_작성일`, usedKeys)
      const inner = setCellPlaceholderText(c.inner, `${ph(`${base}#part#월#2`)} 월`)
      cells[i] = { ...c, inner, text: getCellText(inner).text }
      continue
    }
    if (t === '일' || /^\s*일\s*$/.test(t)) {
      const base: string = splitDateBase ?? uniqueKey(`${dateSection}_작성일`, usedKeys)
      const inner = setCellPlaceholderText(c.inner, `${ph(`${base}#part#일#3`)} 일`)
      cells[i] = { ...c, inner, text: getCellText(inner).text }
      splitDateBase = null
      continue
    }

    const next = cells[i + 1]
    const next2 = cells[i + 2]
    const looksLikeLabel =
      c.text.length > 0 &&
      c.text.length <= 40 &&
      !c.text.includes('□') &&
      !isInputLike(c.rawJoined) &&
      !isGuideOrBody(c.text) &&
      !isCombinedDateCell(c.rawJoined) &&
      (next?.text === ':' ||
        isInputLike(next?.rawJoined || '') ||
        isCombinedDateCell(next?.rawJoined || '') ||
        parseCheckboxOptions(next?.text || '').length >= 2)

    if (/동의합니까/.test(c.text)) {
      lastLabel = /제3자|제공/.test(c.text) ? '제3자제공' : '수집동의'
      continue
    }

    if (/^\([^)]{1,30}\)$/.test(c.text.trim())) {
      if (/미싱|장비/i.test(c.text)) lastLabel = '장비명'
      continue
    }

    if (looksLikeLabel && next?.text !== ':') {
      lastLabel = c.text.replace(/[:：]\s*$/, '').trim()
      continue
    }

    if (next?.text === ':' && next2 && (next2.text === '' || isInputLike(next2.rawJoined)) && !next2.text.includes('{{')) {
      const base = uniqueKey(`${section}_${labelToKeyPart(c.text)}`, usedKeys)
      const inner = setCellPlaceholderText(next2.inner, ph(base))
      cells[i + 2] = { ...next2, inner, text: getCellText(inner).text }
      i += 2
      continue
    }

    if (i > 0 && cells[i - 1].text.includes('#checkbox#') && c.text === '') {
      continue
    }

    if (
      lastLabel &&
      !looksLikeLabel &&
      (c.text === '' || isInputLike(c.rawJoined)) &&
      c.text.length < 80 &&
      !isCombinedDateCell(c.rawJoined)
    ) {
      const base = uniqueKey(`${section}_${labelToKeyPart(lastLabel)}`, usedKeys)
      let inner: string
      if (c.text === '@' || c.rawJoined.trim() === '@') {
        inner = setCellPlaceholderText(c.inner, `@ ${ph(base)}`)
      } else if (c.text.startsWith(':') || c.rawJoined.startsWith(':')) {
        inner = setCellPlaceholderText(c.inner, `: ${ph(base)}`)
      } else {
        inner = setCellPlaceholderText(c.inner, ph(base))
      }
      cells[i] = { ...c, inner, text: getCellText(inner).text }
      splitDateBase = null
      continue
    }
  }

  return cells
}

/**
 * PDF 치환자 규칙(텍스트 / #checkbox# / #select# / #part#)으로 hwpx XML 자동 삽입.
 * Claude 없이 로컬 처리 — 관리자 업로드 시 기본 경로.
 */
export async function embedPlaceholdersByPdfRulesAuto(
  buffer: Buffer,
  defaultSection = '문서'
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer)
  const usedKeys = new Map<string, number>()

  for (const fileName of getSectionFiles(zip)) {
    const file = zip.files[fileName]
    if (!file) continue
    let xmlStr = await file.async('string')

    let tableIdx = 0
    xmlStr = xmlStr.replace(/(<hp:tbl\b[^>]*>)([\s\S]*?)(<\/hp:tbl>)/g, (_m, open, inner, close) => {
      const cells: CellSnap[] = []
      const cellRe = /<hp:tc\b[^>]*>([\s\S]*?)<\/hp:tc>/g
      let cm: RegExpExecArray | null
      while ((cm = cellRe.exec(inner)) !== null) {
        const { text, rawJoined } = getCellText(cm[1])
        cells.push({ text, rawJoined, inner: cm[1] })
      }

      const section =
        tableIdx === 0 ? defaultSection : inferSectionKey(cells[0]?.text || '', defaultSection)
      const processed = processTableCells(cells, section, usedKeys)

      let cellIdx = 0
      const newInner = inner.replace(
        /(<hp:tc\b[^>]*>)([\s\S]*?)(<\/hp:tc>)/g,
        (cm: string, cOpen: string, _cInner: string, cClose: string) => {
          const repl = processed[cellIdx]?.inner ?? _cInner
          cellIdx++
          return `${cOpen}${repl}${cClose}`
        }
      )
      tableIdx++
      return `${open}${newInner}${close}`
    })

    zip.file(fileName, xmlStr)
  }

  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
}

export async function extractPlaceholderInnersFromHwpx(buffer: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(buffer)
  const inners = new Set<string>()
  for (const fileName of getSectionFiles(zip)) {
    const xml = await zip.file(fileName)?.async('string')
    if (!xml) continue
    const re = /\{\{([^}]+)\}\}/g
    let m: RegExpExecArray | null
    while ((m = re.exec(xml)) !== null) inners.add(m[1])
  }
  return Array.from(inners)
}

export async function fieldsFromEmbeddedHwpx(buffer: Buffer): Promise<PlaceholderField[]> {
  const inners = await extractPlaceholderInnersFromHwpx(buffer)
  return fieldsFromPlaceholderInners(inners)
}

function parseDateValue(raw: string): { y: string; m: string; d: string } {
  const s = raw.trim()
  const iso = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/)
  if (iso) return { y: iso[1], m: iso[2].padStart(2, '0'), d: iso[3].padStart(2, '0') }
  const kr = s.match(/^(\d{4})\s*년?\s*(\d{1,2})\s*월?\s*(\d{1,2})/)
  if (kr) return { y: kr[1], m: kr[2].padStart(2, '0'), d: kr[3].padStart(2, '0') }
  return { y: '', m: '', d: '' }
}

export function resolvePdfPlaceholder(
  inner: string,
  values: Record<string, string>,
  escape: (s: string) => string
): string {
  const p = parsePlaceholderInner(inner)
  if (p.type === 'checkbox') {
    const selected = (values[p.baseKey] || '')
      .split(/[,，\n]/)
      .map(s => s.trim())
      .filter(Boolean)
    const opt = p.option || ''
    const on = selected.some(s => s === opt || norm(s) === norm(opt))
    return `${on ? HWPX_CHECKED : HWPX_UNCHECKED} ${opt}`
  }
  if (p.type === 'select') {
    const chosen = (values[p.baseKey] || '').trim()
    const opt = p.option || ''
    return `${chosen === opt ? HWPX_CHECKED : HWPX_UNCHECKED} ${opt}`
  }
  if (p.type === 'part') {
    const { y, m, d } = parseDateValue(values[p.baseKey] || '')
    const partVal = p.part === '년' ? y : p.part === '월' ? m : p.part === '일' ? d : ''
    return escape(partVal)
  }
  const raw = values[inner] ?? values[p.baseKey] ?? ''
  return escape(raw)
}

export { HWPX_CHECKED, HWPX_UNCHECKED }
