import { readFileSync } from 'fs'
import JSZip from 'jszip'

const p =
  'src/sample_hwpx/[강동가죽제조지원센터] 가죽·패션산업 소공인 장비지원 사업 신청서.hwpx'

async function main() {
  const zip = await JSZip.loadAsync(readFileSync(p))
  const xml = await zip.file('Contents/section0.xml')!.async('string')
  let i = 0
  const cellRe = /<hp:tc\b([^>]*)>([\s\S]*?)<\/hp:tc>/g
  let cm: RegExpExecArray | null
  while ((cm = cellRe.exec(xml)) !== null) {
    const attrs = cm[1]
    const inner = cm[2]
    const texts: string[] = []
    const tRe = /<hp:t[^>]*>([^<]*)<\/hp:t>/g
    let t: RegExpExecArray | null
    while ((t = tRe.exec(inner)) !== null) texts.push(t[1])
    const text = texts.join('').trim().replace(/\s+/g, ' ')
    const editable = attrs.match(/editable="([^"]*)"/)?.[1] ?? '(없음)'
    const header = attrs.match(/header="([^"]*)"/)?.[1] ?? '?'
    if (text.length < 80) {
      console.log(
        `#${i} editable=${editable} header=${header} | ${JSON.stringify(text)}`
      )
    }
    i++
  }
  console.log('total cells', i)
}
main()
