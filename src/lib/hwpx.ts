import JSZip from 'jszip'
import { parseStringPromise } from 'xml2js'

/**
 * hwpx 파일(Buffer)에서 텍스트 추출
 * hwpx = ZIP 컨테이너 안에 XML 파일들
 */
export async function extractTextFromHwpx(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer)

  // hwpx 내부 구조: Contents/section0.xml, section1.xml ...
  const sectionFiles = Object.keys(zip.files).filter(
    name => name.match(/Contents\/section\d+\.xml/i) || name.match(/content\.hpf/i)
  )

  if (sectionFiles.length === 0) {
    // fallback: 모든 xml 파일 시도
    const xmlFiles = Object.keys(zip.files).filter(n => n.endsWith('.xml'))
    if (xmlFiles.length === 0) throw new Error('hwpx 내부에서 XML을 찾을 수 없습니다.')
    sectionFiles.push(...xmlFiles.slice(0, 3))
  }

  const texts: string[] = []

  for (const fileName of sectionFiles) {
    const file = zip.files[fileName]
    if (!file) continue
    const xmlStr = await file.async('string')
    const text = extractTextFromXml(xmlStr)
    if (text.trim()) texts.push(text)
  }

  return texts.join('\n\n').trim()
}

/**
 * hwpx XML에서 텍스트 노드만 추출
 * 태그를 제거하고 <hp:t> 요소의 텍스트를 줄 단위로 조합
 */
function extractTextFromXml(xmlStr: string): string {
  // hp:t 태그 안의 텍스트 추출 (hwpx 텍스트 요소)
  const lines: string[] = []

  // <hp:t> 또는 <t> 텍스트 내용 추출
  const textTagRegex = /<(?:hp:t|hh:t|t)[^>]*>([^<]*)<\/(?:hp:t|hh:t|t)>/g
  const paraRegex = /<(?:hp:p|p)[^>]*>/g

  // 단락 단위로 분리하여 텍스트 수집
  const paras = xmlStr.split(paraRegex)
  for (const para of paras) {
    const parts: string[] = []
    let m: RegExpExecArray | null
    const re = /<(?:hp:t|hh:t|t)[^>]*>([^<]*)<\/(?:hp:t|hh:t|t)>/g
    while ((m = re.exec(para)) !== null) {
      if (m[1].trim()) parts.push(m[1])
    }
    if (parts.length > 0) lines.push(parts.join(''))
  }

  if (lines.length === 0) {
    // 최후 수단: 모든 태그 제거
    return xmlStr
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  return lines.join('\n')
}

/**
 * 치환자가 적용된 processedText에서 {{key}} 치환 후 Buffer 반환
 * 실제 hwpx 파일의 XML 내 텍스트를 직접 replace
 */
export async function applyPlaceholdersToHwpx(
  hwpxBuffer: Buffer,
  processedText: string,
  values: Record<string, string>
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(hwpxBuffer)

  // section xml 파일들에서 치환자 replace
  const sectionFiles = Object.keys(zip.files).filter(
    name => name.match(/Contents\/section\d+\.xml/i)
  )

  // 값 치환 맵 준비
  const replacements: Record<string, string> = {}
  for (const [key, val] of Object.entries(values)) {
    replacements[`{{${key}}}`] = val || ''
  }

  for (const fileName of sectionFiles) {
    const file = zip.files[fileName]
    if (!file) continue
    let xmlStr = await file.async('string')

    // XML 안의 치환자 텍스트 교체
    for (const [placeholder, value] of Object.entries(replacements)) {
      // XML 특수문자 이스케이프
      const safeValue = value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
      xmlStr = xmlStr.split(placeholder).join(safeValue)
    }

    zip.file(fileName, xmlStr)
  }

  const result = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  return Buffer.from(result)
}
