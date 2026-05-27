import { readFileSync } from 'fs'
import JSZip from 'jszip'

const p =
  'src/sample_hwpx/[강동가죽제조지원센터] 가죽·패션산업 소공인 장비지원 사업 신청서.hwpx.vscode.bak'

async function main() {
  const zip = await JSZip.loadAsync(readFileSync(p))
  for (const name of Object.keys(zip.files).sort()) {
    if (!/section\d+\.xml/i.test(name)) continue
    const xml = await zip.file(name)!.async('string')
    let ti = 0
    const tblRe = /<hp:tbl\b[^>]*>[\s\S]*?<\/hp:tbl>/g
    let tm: RegExpExecArray | null
    while ((tm = tblRe.exec(xml)) !== null) {
      const tbl = tm[0]
      let ci = 0
      const cellRe = /<hp:tc\b[^>]*>([\s\S]*?)<\/hp:tc>/g
      let cm: RegExpExecArray | null
      while ((cm = cellRe.exec(tbl)) !== null) {
        const texts: string[] = []
        const tRe = /<hp:t[^>]*>([^<]*)<\/hp:t>/g
        let t: RegExpExecArray | null
        while ((t = tRe.exec(cm[1])) !== null) texts.push(t[1])
        const raw = texts.join('')
        const text = raw.trim()
        if (text) console.log(`[${name}] T${ti} C${ci}: ${JSON.stringify(text.slice(0, 80))}`)
        ci++
      }
      ti++
    }
  }
}
main()
