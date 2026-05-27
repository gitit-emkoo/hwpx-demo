import { readFileSync } from 'fs'
import JSZip from 'jszip'

const p =
  'src/sample_hwpx/[강동가죽제조지원센터] 가죽·패션산업 소공인 장비지원 사업 신청서.before-placeholders.hwpx'

async function main() {
  const zip = await JSZip.loadAsync(readFileSync(p))
  let xml = ''
  for (const n of Object.keys(zip.files).sort()) {
    if (/section\d+\.xml/i.test(n)) xml += await zip.file(n)!.async('string')
  }
  let i = 0
  const cellRe = /<hp:tc\b([^>]*)>([\s\S]*?)<\/hp:tc>/g
  let cm: RegExpExecArray | null
  while ((cm = cellRe.exec(xml)) !== null) {
    const texts: string[] = []
    const tRe = /<hp:t[^>]*>([^<]*)<\/hp:t>/g
    let t: RegExpExecArray | null
    while ((t = tRe.exec(cm[1])) !== null) texts.push(`[${JSON.stringify(t[1])}]`)
    const joined = texts.join(' ')
    if (/기업명|설립일|사업자|연락처|성명|이메일/.test(joined)) {
      console.log(`#${i}`, texts.join(' '))
    }
    i++
  }
}
main()
