import { readFileSync } from 'fs'
import JSZip from 'jszip'

const path = process.argv[2] || 'src/sample_hwpx/[강동가죽제조지원센터] 가죽·패션산업 소공인 장비지원 사업 신청서.before-placeholders.hwpx'

async function main() {
  const buf = readFileSync(path)
  const zip = await JSZip.loadAsync(buf)
  for (const name of Object.keys(zip.files).sort()) {
    if (!/section\d+\.xml/i.test(name)) continue
    const xml = await zip.file(name)!.async('string')
    const tblRe = /<hp:tbl\b[^>]*>[\s\S]*?<\/hp:tbl>/g
    let ti = 0
    let tm: RegExpExecArray | null
    while ((tm = tblRe.exec(xml)) !== null) {
      const cells: string[] = []
      const cellRe = /<hp:tc\b[^>]*>([\s\S]*?)<\/hp:tc>/g
      let cm: RegExpExecArray | null
      while ((cm = cellRe.exec(tm[0])) !== null) {
        const texts: string[] = []
        const tRe = /<hp:t[^>]*>([^<]*)<\/hp:t>/g
        let t: RegExpExecArray | null
        while ((t = tRe.exec(cm[1])) !== null) texts.push(t[1])
        cells.push(texts.join('').trim().replace(/\s+/g, ' ').slice(0, 100))
      }
      if (cells.length) {
        console.log(`\n--- ${name} tbl${ti} (${cells.length}) ---`)
        cells.forEach((c, i) => console.log(`  [${i}] ${JSON.stringify(c)}`))
        ti++
      }
    }
  }
}

main()
