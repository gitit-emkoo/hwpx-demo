import { readFileSync } from 'fs'
import JSZip from 'jszip'
import { extractTextFromHwpx } from '../src/lib/hwpx'

const CURRENT =
  'src/sample_hwpx/[강동가죽제조지원센터] 가죽·패션산업 소공인 장비지원 사업 신청서.hwpx'
const BEFORE =
  'src/sample_hwpx/[강동가죽제조지원센터] 가죽·패션산업 소공인 장비지원 사업 신청서.before-placeholders.hwpx'

const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase()

async function analyzeTables(xml: string, tag: string) {
  console.log(`\n=== ${tag}: 표·셀 순서 (레이블 → 다음 칸) ===\n`)
  const tblRe = /<hp:tbl\b[^>]*>[\s\S]*?<\/hp:tbl>/g
  let tblIdx = 0
  let tm: RegExpExecArray | null
  while ((tm = tblRe.exec(xml)) !== null) {
    const tbl = tm[0]
    const cells: { text: string; hasPh: boolean; ph: string[] }[] = []
    const cellRe = /<hp:tc\b[^>]*>([\s\S]*?)<\/hp:tc>/g
    let cm: RegExpExecArray | null
    while ((cm = cellRe.exec(tbl)) !== null) {
      const inner = cm[1]
      const texts: string[] = []
      const tRe = /<hp:t[^>]*>([^<]*)<\/hp:t>/g
      let t: RegExpExecArray | null
      while ((t = tRe.exec(inner)) !== null) texts.push(t[1])
      const raw = texts.join('')
      const ph: string[] = []
      const phRe = /\{\{([^}]+)\}\}/g
      let pm: RegExpExecArray | null
      while ((pm = phRe.exec(raw)) !== null) ph.push(pm[1])
      cells.push({
        text: raw.trim().replace(/\s+/g, ' ').slice(0, 60),
        hasPh: ph.length > 0,
        ph,
      })
    }
    if (cells.length === 0) continue
    console.log(`--- 표 ${tblIdx} (${cells.length}칸) ---`)
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i]
      const marker = c.hasPh ? `  ★ {{${c.ph.join('}}{{')}}} ` : ''
      console.log(`  [${i}] ${JSON.stringify(c.text)}${marker}`)
      // 레이블 다음 칸에 치환자가 있어야 하는 패턴
      const labels = ['기업명', '설립일', '사업자등록번호', '사업장 주소', '연락처', '이메일', '홈페이지', 'SNS', '성명', '생년월일', '핸드폰']
      for (const lb of labels) {
        if (norm(c.text).includes(norm(lb)) && !c.hasPh && i + 1 < cells.length) {
          const next = cells[i + 1]
          if (next.hasPh) {
            console.log(`      ✓ "${lb}" 다음 칸에 치환자: ${next.ph.join(', ')}`)
          } else if (next.text.length < 30) {
            console.log(`      ✗ "${lb}" 다음 칸(${i + 1})에 치환자 없음: ${JSON.stringify(next.text)}`)
          }
        }
      }
    }
    tblIdx++
  }
}

async function main() {
  const curBuf = readFileSync(CURRENT)
  const beforeBuf = readFileSync(BEFORE)
  console.log('파일 크기:', '현재', curBuf.length, '/ 백업', beforeBuf.length)

  const curText = await extractTextFromHwpx(curBuf)
  const beforeText = await extractTextFromHwpx(beforeBuf)
  console.log('텍스트 길이:', '현재', curText.length, '/ 백업', beforeText.length)

  const phRe = /\{\{([^}]+)\}\}/g
  const keys = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = phRe.exec(curText)) !== null) keys.add(m[1])
  console.log('\n치환자 종류', keys.size, ':')
  ;[...keys].sort().forEach(k => console.log(' ', k))

  const zip = await JSZip.loadAsync(curBuf)
  let allXml = ''
  for (const name of Object.keys(zip.files).sort()) {
    if (/section\d+\.xml/i.test(name)) {
      allXml += await zip.file(name)!.async('string')
    }
  }
  await analyzeTables(allXml, '현재 파일')

  // 의심 패턴
  console.log('\n=== 검사 ===')
  if (curText.includes('{{신청서_이메일}}') && curText.split('{{신청서_이메일}}').length > 2) {
    console.log('⚠ 이메일 치환자가 여러 곳에 있음 (대표자 이메일과 중복 가능)')
  }
  if (!curText.includes('{{신청서_매출액}}') && beforeText.includes('매출')) {
    console.log('⚠ 매출액 치환자 없음')
  }
  if (!curText.includes('멜로우') && beforeText.includes('멜로우')) {
    console.log('⚠ 장비 선택 치환자 없음')
  }
  if (curText.length < beforeText.length * 0.9) {
    console.log('⚠ 본문 길이가 백업보다 많이 줄음 — 내용 손실 의심')
  } else {
    console.log('✓ 본문 길이 유지됨')
  }
}

main()
