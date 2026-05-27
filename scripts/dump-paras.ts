import { readFileSync } from 'fs'
import JSZip from 'jszip'

const p =
  'src/sample_hwpx/[강동가죽제조지원센터] 가죽·패션산업 소공인 장비지원 사업 신청서.hwpx'

async function main() {
  const zip = await JSZip.loadAsync(readFileSync(p))
  const xml = await zip.file('Contents/section0.xml')!.async('string')
  let i = 0
  const paraRe = /<hp:p\b[^>]*>([\s\S]*?)<\/hp:p>/g
  let pm: RegExpExecArray | null
  while ((pm = paraRe.exec(xml)) !== null) {
    const texts: string[] = []
    const tRe = /<hp:t[^>]*>([^<]*)<\/hp:t>/g
    let t: RegExpExecArray | null
    while ((t = tRe.exec(pm[1])) !== null) texts.push(t[1])
    const text = texts.join('').trim()
    if (text) console.log(`P${i}: ${JSON.stringify(text.slice(0, 120))}`)
    i++
  }
  console.log('total paras', i)
}
main()
