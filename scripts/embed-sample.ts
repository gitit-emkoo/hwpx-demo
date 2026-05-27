/**
 * 로컬 샘플 hwpx에 치환자 심기 (일회성 스크립트)
 * 사용: npx tsx scripts/embed-sample.ts
 */
import { existsSync, readFileSync, writeFileSync } from 'fs'
import Anthropic from '@anthropic-ai/sdk'
import {
  extractTextFromHwpx,
  embedPlaceholdersByClaudePerTable,
} from '../src/lib/hwpx'

if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i < 0) continue
    const k = t.slice(0, i).trim()
    let v = t.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1)
    if (!process.env[k]) process.env[k] = v.replace(/\\n/g, '\n')
  }
}

const HWPX_PATH =
  'src/sample_hwpx/[강동가죽제조지원센터] 가죽·패션산업 소공인 장비지원 사업 신청서.hwpx'

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY가 .env.local에 없습니다.')
    process.exit(1)
  }
  const buf = readFileSync(HWPX_PATH)
  const text = await extractTextFromHwpx(buf)
  console.log('원문 길이:', text.length)
  console.log('--- 원문 미리보기 (앞 2500자) ---\n')
  console.log(text.slice(0, 2500))

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  console.log('\n--- Claude 표 단위 치환자 심는 중... ---\n')
  const { hwpxBuffer, fields } = await embedPlaceholdersByClaudePerTable(
    buf,
    '신청서',
    anthropic
  )
  writeFileSync(HWPX_PATH, hwpxBuffer)
  console.log('저장 완료:', HWPX_PATH)
  console.log('필드 수:', fields.length)
  for (const f of fields) console.log(`  {{${f.key}}}  (${f.label})`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
