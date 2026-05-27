export type FieldType = 'text' | 'date' | 'select' | 'checkbox' | 'textarea'

export interface PlaceholderField {
  key:      string       // e.g. "applicant_name"
  label:    string       // e.g. "성명"
  type:     FieldType
  options?: string[]     // select 일 때만
  required: boolean
}

export interface FormTemplate {
  id:            string
  title:         string
  originalText:  string   // hwpx에서 추출한 원본 텍스트
  processedText: string   // {{치환자}} 삽입된 텍스트
  fields:        PlaceholderField[]
  hwpxStoragePath: string // Firebase Storage 경로
  /** Claude가 참조 이미지·hwpx 구조로 생성한 HTML 미리보기 (없으면 휴리스틱 fallback) */
  previewHtml?:   string
  createdAt:     number
}

export interface Submission {
  id:         string
  templateId: string
  values:     Record<string, string>
  createdAt:  number
}
