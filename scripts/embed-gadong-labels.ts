import { existsSync, readFileSync, writeFileSync } from 'fs'
import JSZip from 'jszip'
import { extractTextFromHwpx, embedPlaceholdersByLabel } from '../src/lib/hwpx'

const HWPX =
  'src/sample_hwpx/[강동가죽제조지원센터] 가죽·패션산업 소공인 장비지원 사업 신청서.hwpx'
const BAK = HWPX.replace('.hwpx', '.before-placeholders.hwpx')

/** 신청서 본문 + 동의/서약 (레이블은 XML 셀 텍스트와 동일하게) */
const FIELDS: { key: string; label: string }[] = [
  { key: '신청서_기업명', label: '기업명' },
  { key: '신청서_설립일', label: '설립일' },
  { key: '신청서_사업자등록번호', label: '사업자등록번호' },
  { key: '신청서_사업장주소', label: '사업장 주소' },
  { key: '신청서_연락처', label: '연락처' },
  { key: '신청서_이메일', label: '이메일' },
  { key: '신청서_홈페이지', label: '홈페이지' },
  { key: '신청서_SNS', label: 'SNS채널' },
  { key: '신청서_주생산분야', label: '주 생산분야' },
  { key: '신청서_주요판매제품', label: '주요 판매 제품' },
  { key: '신청서_매출액', label: "25' 매출액" },
  { key: '신청서_상시종사자수', label: '상시 종사자 수' },
  { key: '신청서_판매처', label: '판매처' },
  { key: '신청서_대표자성명', label: '성명' },
  { key: '신청서_생년월일', label: '생년월일' },
  { key: '신청서_핸드폰', label: '핸드폰' },
  { key: '신청서_장비_멜로우', label: '멜로우라이트회전말뚝미싱' },
  { key: '신청서_장비_썬스타', label: '썬스타말뚝' },
  { key: '신청서_장비_야쿠모', label: '야쿠모후물미싱' },
  { key: '동의_수집이용', label: '개인정보 수집' },
  { key: '동의_제3자', label: '개인정보 제공' },
  { key: '서약_업체명', label: '업  체  명' },
  { key: '서약_대표자성명', label: '대표자성명' },
]

async function stripExisting(buf: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buf)
  for (const name of Object.keys(zip.files)) {
    if (!/section\d+\.xml/i.test(name)) continue
    const f = zip.files[name]
    if (!f) continue
    let xml = await f.async('string')
    xml = xml.replace(/\{\{[^}]*\}\}/g, '')
    zip.file(name, xml)
  }
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
}

async function main() {
  let buf = readFileSync(HWPX)
  if (!existsSync(BAK)) writeFileSync(BAK, buf)

  const before = await extractTextFromHwpx(buf)
  if (before.includes('{{')) buf = await stripExisting(buf)

  const out = await embedPlaceholdersByLabel(buf, FIELDS)
  writeFileSync(HWPX, out)

  const after = await extractTextFromHwpx(out)
  const ph = [...new Set(after.match(/\{\{[^}]+\}\}/g) || [])]
  console.log('치환자', ph.length, '종류')
  ph.sort().forEach(x => console.log(' ', x))
}

main()
