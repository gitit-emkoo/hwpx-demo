import { readFileSync } from 'fs'
import JSZip from 'jszip'

const DEFAULT =
  'src/sample_hwpx/[강동가죽제조지원센터] 가죽·패션산업 소공인 장비지원 사업 신청서.before-placeholders.hwpx'
const path = process.argv[2]?.endsWith('.hwpx') ? process.argv[2] : DEFAULT
const tableIdx = parseInt(process.argv[2]?.endsWith('.hwpx') ? process.argv[3]! : process.argv[2] || '0', 10)
const cellIdx = parseInt(process.argv[2]?.endsWith('.hwpx') ? process.argv[4]! : process.argv[3] || '5', 10)

async function main() {
  const zip = await JSZip.loadAsync(readFileSync(path))
  const xml = await zip.file('Contents/section0.xml')!.async('string')
  const tblRe = /<hp:tbl\b[^>]*>[\s\S]*?<\/hp:tbl>/g
  let ti = 0
  let tm: RegExpExecArray | null
  while ((tm = tblRe.exec(xml)) !== null) {
    if (ti !== tableIdx) {
      ti++
      continue
    }
    const cellRe = /<hp:tc\b[^>]*>([\s\S]*?)<\/hp:tc>/g
    let ci = 0
    let cm: RegExpExecArray | null
    while ((cm = cellRe.exec(tm[0])) !== null) {
      if (ci === cellIdx) {
        console.log(cm[1].slice(0, 2000))
        return
      }
      ci++
    }
    ti++
  }
}

main()
