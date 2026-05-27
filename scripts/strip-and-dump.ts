import { readFileSync, writeFileSync } from 'fs'
import JSZip from 'jszip'

const BAK =
  'src/sample_hwpx/[강동가죽제조지원센터] 가죽·패션산업 소공인 장비지원 사업 신청서.hwpx.vscode.bak'
const OUT =
  'src/sample_hwpx/[강동가죽제조지원센터] 가죽·패션산업 소공인 장비지원 사업 신청서.hwpx'

async function main() {
  const zip = await JSZip.loadAsync(readFileSync(BAK))
  for (const name of Object.keys(zip.files)) {
    if (!/section\d+\.xml/i.test(name)) continue
    const file = zip.file(name)!
    let xml = await file.async('string')
    xml = xml.replace(/\{\{[^}]*\}\}/g, '')
    zip.file(name, xml)
  }
  const clean = Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
  writeFileSync(OUT, clean)
  writeFileSync(BAK.replace('.bak', '.clean.bak'), clean)

  const xml = await zip.file('Contents/section0.xml')!.async('string')
  let ti = 0
  const tblRe = /<hp:tbl\b[^>]*>[\s\S]*?<\/hp:tbl>/g
  let tm: RegExpExecArray | null
  while ((tm = tblRe.exec(xml)) !== null) {
    let ci = 0
    const cellRe = /<hp:tc\b[^>]*>([\s\S]*?)<\/hp:tc>/g
    let cm: RegExpExecArray | null
    while ((cm = cellRe.exec(tm[0])) !== null) {
      const texts: string[] = []
      const tRe = /<hp:t[^>]*>([^<]*)<\/hp:t>/g
      let t: RegExpExecArray | null
      while ((t = tRe.exec(cm[1])) !== null) texts.push(t[1])
      const text = texts.join('').trim()
      if (text) console.log(`T${ti} C${ci}: ${JSON.stringify(text.slice(0, 100))}`)
      ci++
    }
    ti++
  }
}
main()
