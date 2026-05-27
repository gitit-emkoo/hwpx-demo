import { readFileSync } from 'fs'
import JSZip from 'jszip'

const p =
  'src/sample_hwpx/[강동가죽제조지원센터] 가죽·패션산업 소공인 장비지원 사업 신청서.hwpx'
async function main() {
  const zip = await JSZip.loadAsync(readFileSync(p))
  let n = 0
  const found: string[] = []
  for (const name of Object.keys(zip.files)) {
    if (!/section\d+\.xml/i.test(name)) continue
    const xml = await zip.file(name)!.async('string')
    const re = /\{\{([^}]+)\}\}/g
    let m: RegExpExecArray | null
    while ((m = re.exec(xml)) !== null) {
      n++
      found.push(m[1])
    }
  }
  console.log('count', n)
  console.log([...new Set(found)].join('\n'))
}
main()
