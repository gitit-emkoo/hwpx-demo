import { existsSync, readFileSync, writeFileSync } from 'fs'
import JSZip from 'jszip'
import { extractTextFromHwpx, embedPlaceholdersByLabel } from '../src/lib/hwpx'

const HWPX_PATH =
  'src/sample_hwpx/[강동가죽제조지원센터] 가죽·패션산업 소공인 장비지원 사업 신청서.hwpx'
const CLEAN_BAK = HWPX_PATH.replace('.hwpx', '.hwpx.vscode.bak')

const FIELDS: { key: string; label: string }[] = [
  { key: '신청서_기업명', label: '기업명' },
  { key: '신청서_설립일', label: '설립일' },
  { key: '신청서_사업자등록번호', label: '사업자등록번호' },
  { key: '신청서_사업장주소', label: '사업장 주소' },
  { key: '신청서_연락처', label: '연락처' },
  { key: '신청서_이메일', label: '이메일' },
  { key: '신청서_홈페이지', label: '홈페이지' },
  { key: '신청서_SNS채널', label: 'SNS채널' },
  { key: '신청서_주생산분야', label: '주 생산분야' },
  { key: '신청서_주요판매제품', label: '주요 판매 제품' },
  { key: '신청서_매출액', label: "25' 매출액" },
  { key: '신청서_상시종사자수', label: '상시 종사자 수' },
  { key: '신청서_판매처', label: '판매처' },
  { key: '신청서_대표자성명', label: '성명' },
  { key: '신청서_생년월일', label: '생년월일' },
  { key: '신청서_핸드폰', label: '핸드폰' },
  { key: '신청서_장비_멜로우라이트', label: '멜로우라이트회전말뚝미싱' },
  { key: '신청서_장비_썬스타', label: '썬스타말뚝' },
  { key: '신청서_장비_야쿠모', label: '야쿠모후물미싱' },
  { key: '신청서_신청서명년월일', label: '대표자(신청자)' },
  { key: '동의서_수집이용_동의함', label: '수집' },
  { key: '동의서_제3자제공_동의함', label: '제3자 제공' },
  { key: '동의서_동의자서명', label: '동 의 자' },
  { key: '서약서_서명일', label: '2026년' },
  { key: '서약서_업체명', label: '업  체  명' },
  { key: '서약서_대표자성명', label: '대표자성명' },
]

async function stripPlaceholders(buffer: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer)
  for (const name of Object.keys(zip.files)) {
    if (!/section\d+\.xml/i.test(name)) continue
    const file = zip.file(name)
    if (!file) continue
    let xml = await file.async('string')
    xml = xml.replace(/\{\{[^}]*\}\}/g, '')
    zip.file(name, xml)
  }
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
}

async function main() {
  let buf = readFileSync(HWPX_PATH)

  if (!existsSync(CLEAN_BAK)) {
    writeFileSync(CLEAN_BAK, buf)
    console.log('백업 생성 (치환자 없는 원본 보관):', CLEAN_BAK)
  } else {
    const bakBuf = readFileSync(CLEAN_BAK)
    const zip = await JSZip.loadAsync(bakBuf)
    let hasPh = false
    for (const name of Object.keys(zip.files)) {
      if (!/section\d+\.xml/i.test(name)) continue
      const xml = await zip.file(name)!.async('string')
      if (xml.includes('{{')) hasPh = true
    }
    if (!hasPh) {
      buf = bakBuf
      console.log('백업 원본 사용')
    } else {
      buf = await stripPlaceholders(buf)
      console.log('기존 치환자 제거 후 재작업')
    }
  }

  const out = await embedPlaceholdersByLabel(buf, FIELDS)
  writeFileSync(HWPX_PATH, out)

  const text = await extractTextFromHwpx(out)
  const matches = [...new Set(text.match(/\{\{[^}]+\}\}/g) || [])]
  console.log('\n치환자', matches.length, '종류:')
  matches.sort().forEach(m => console.log(' ', m))
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
