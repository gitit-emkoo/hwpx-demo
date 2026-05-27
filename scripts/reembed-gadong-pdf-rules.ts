import { readFileSync, writeFileSync } from 'fs'
import { extractTextFromHwpx } from '../src/lib/hwpx'
import {
  embedPlaceholdersByPdfRulesAuto,
  fieldsFromEmbeddedHwpx,
} from '../src/lib/pdf-rules-embed'

const HWPX =
  'src/sample_hwpx/[강동가죽제조지원센터] 가죽·패션산업 소공인 장비지원 사업 신청서.hwpx'
const BEFORE =
  'src/sample_hwpx/[강동가죽제조지원센터] 가죽·패션산업 소공인 장비지원 사업 신청서.before-placeholders.hwpx'

async function main() {
  const buf = readFileSync(BEFORE)
  writeFileSync(HWPX, buf)
  console.log('백업에서 복구 완료')

  const out = await embedPlaceholdersByPdfRulesAuto(buf, '신청')
  writeFileSync(HWPX, out)

  const fields = await fieldsFromEmbeddedHwpx(out)
  const text = await extractTextFromHwpx(out)
  const keys = [...new Set(text.match(/\{\{[^}]+\}\}/g) || [])]
  console.log('필드', fields.length, '종 / 치환자 토큰', keys.length, '개')
  fields.forEach(f => console.log(`  ${f.type}\t${f.key}\t${f.label}${f.options?.length ? ` (${f.options.length}옵션)` : ''}`))
}

main()
