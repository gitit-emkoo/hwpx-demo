import { readFileSync } from 'fs'
import JSZip from 'jszip'

const p =
  'src/sample_hwpx/[강동가죽제조지원센터] 가죽·패션산업 소공인 장비지원 사업 신청서.hwpx'

async function main() {
  const zip = await JSZip.loadAsync(readFileSync(p))
  for (const name of Object.keys(zip.files).sort()) {
    if (!/section\d+\.xml/i.test(name)) continue
    const xml = await zip.file(name)!.async('string')
    let i = 0
    const cellRe = /<hp:tc\b[^>]*>([\s\S]*?)<\/hp:tc>/g
    let cm: RegExpExecArray | null
    while ((cm = cellRe.exec(xml)) !== null) {
      const texts: string[] = []
      const tRe = /<hp:t[^>]*>([^<]*)<\/hp:t>/g
      let t: RegExpExecArray | null
      while ((t = tRe.exec(cm[1])) !== null) texts.push(t[1])
      const text = texts.join('').trim()
      if (text && text.length < 120) console.log(`${name} #${i}: ${JSON.stringify(text)}`)
      i++
    }
    console.log(`--- ${name} total cells: ${i}`)
  }
}
main()
