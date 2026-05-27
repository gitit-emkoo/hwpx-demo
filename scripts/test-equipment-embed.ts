import { readFileSync } from 'fs'
import { embedPlaceholdersByPdfRulesAuto } from '../src/lib/pdf-rules-embed'
import { extractTextFromHwpx } from '../src/lib/hwpx'

const path =
  process.argv[2] ||
  'src/sample_hwpx/[강동가죽제조지원센터] 가죽·패션산업 소공인 장비지원 사업 신청서.hwpx'

async function main() {
  const buf = readFileSync(path)
  const out = await embedPlaceholdersByPdfRulesAuto(buf, '신청서')
  const text = await extractTextFromHwpx(out)
  const block = text
    .split('\n')
    .filter(l => /장비|미싱|멜로우|야쿠모|활용계획|신청인/.test(l))
    .join('\n')
  console.log(block)
  const hasPlan = /\{\{장비활용계획_활용계획\}\}/.test(text)
  const cbCount = (text.match(/장비활용계획_장비명#checkbox#/g) || []).length
  console.log('\n활용계획 치환자:', hasPlan ? 'OK' : 'MISSING')
  console.log('장비 체크박스:', cbCount, '개')
  if (!hasPlan || cbCount < 3) process.exit(1)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
