'use client'

import { useState, useRef, useEffect } from 'react'
import type { FormTemplate, PlaceholderField } from '@/lib/types'

type Step = 'upload' | 'analyzing' | 'review' | 'done'

const ANALYZING_MESSAGES = [
  'hwpx 파일에서 텍스트를 추출하고 있습니다...',
  '참조 이미지가 있으면 Claude가 화면으로 입력 칸을 구분합니다...',
  'Claude AI가 문서 구조를 파악하고 있습니다...',
  '빈칸과 입력 필드를 감지하고 있습니다...',
  '치환자 키를 생성하고 있습니다...',
  '거의 다 됐습니다...',
]

export default function AdminPage() {
  const [step, setStep]             = useState<Step>('upload')
  const [title, setTitle]           = useState('')
  const [file, setFile]             = useState<File | null>(null)
  const [referenceImages, setReferenceImages] = useState<File[]>([])
  const [template, setTemplate]     = useState<FormTemplate | null>(null)
  const [error, setError]           = useState<string | null>(null)
  const [saving, setSaving]         = useState(false)
  const [elapsed, setElapsed]       = useState(0)
  const [msgIdx, setMsgIdx]         = useState(0)
  const [newFieldLabel, setNewFieldLabel] = useState('')
  const [newFieldKey, setNewFieldKey]     = useState('')
  const [newFieldType, setNewFieldType]   = useState<PlaceholderField['type']>('text')
  const [addingField, setAddingField]     = useState(false)
  const [listedTemplateCount, setListedTemplateCount] = useState<number | null>(null)
  const fileInputRef    = useRef<HTMLInputElement>(null)
  const imageInputRef   = useRef<HTMLInputElement>(null)
  const textareaRef     = useRef<HTMLTextAreaElement>(null)
  const timerRef        = useRef<ReturnType<typeof setInterval> | null>(null)
  const msgTimerRef     = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (step === 'analyzing') {
      setElapsed(0)
      setMsgIdx(0)
      timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000)
      msgTimerRef.current = setInterval(() => setMsgIdx(i => Math.min(i + 1, ANALYZING_MESSAGES.length - 1)), 4000)
    } else {
      if (timerRef.current)    clearInterval(timerRef.current)
      if (msgTimerRef.current) clearInterval(msgTimerRef.current)
    }
    return () => {
      if (timerRef.current)    clearInterval(timerRef.current)
      if (msgTimerRef.current) clearInterval(msgTimerRef.current)
    }
  }, [step])

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ''))
    setError(null)
  }

  function handleReferenceImagesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const list = e.target.files ? Array.from(e.target.files) : []
    setReferenceImages(list)
    setError(null)
  }

  async function handleUpload() {
    if (!file) return
    setStep('analyzing')
    setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('title', title)
      referenceImages.forEach(img => fd.append('images', img))
      const res  = await fetch('/api/upload', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '업로드 실패')
      setTemplate(data)
      setStep('review')
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류 발생')
      setStep('upload')
      setReferenceImages([])
    }
  }

  async function handleSave() {
    if (!template) return
    // processedText에 실제로 사용된 key만 fields에 남기기
    const usedKeys = new Set<string>()
    const regex = /\{\{([^}]+)\}\}/g
    let m: RegExpExecArray | null
    while ((m = regex.exec(template.processedText)) !== null) usedKeys.add(m[1])
    const syncedFields = template.fields.filter(f => usedKeys.has(f.key))
    // processedText에 있지만 fields에 없는 key는 자동으로 text 타입으로 추가
    usedKeys.forEach(key => {
      if (!syncedFields.find(f => f.key === key)) {
        syncedFields.push({ key, label: key, type: 'text', required: false })
      }
    })
    setSaving(true)
    try {
      const res = await fetch(`/api/templates/${template.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: syncedFields, processedText: template.processedText, title }),
      })
      if (!res.ok) throw new Error('저장 실패')
      setStep('done')
      fetch('/api/templates', { cache: 'no-store' })
        .then(r => r.json())
        .then(data => setListedTemplateCount(Array.isArray(data) ? data.length : null))
        .catch(() => setListedTemplateCount(null))
    } catch {
      setError('저장 실패')
    }
    setSaving(false)
  }

  function updateField(i: number, patch: Partial<PlaceholderField>) {
    if (!template) return
    const fields = [...template.fields]
    const oldKey = fields[i].key
    fields[i] = { ...fields[i], ...patch }
    // key가 바뀌면 processedText도 함께 업데이트
    if (patch.key && patch.key !== oldKey) {
      const newProcessed = template.processedText.split(`{{${oldKey}}}`).join(`{{${patch.key}}}`)
      setTemplate({ ...template, fields, processedText: newProcessed })
    } else {
      setTemplate({ ...template, fields })
    }
  }

  function deleteField(i: number) {
    if (!template) return
    const field = template.fields[i]
    const fields = template.fields.filter((_, idx) => idx !== i)
    // processedText에서 해당 치환자 제거
    const newProcessed = template.processedText.split(`{{${field.key}}}`).join(`[${field.label}]`)
    setTemplate({ ...template, fields, processedText: newProcessed })
  }

  // 커서 위치에 {{key}} 삽입
  function insertPlaceholderAtCursor(key: string) {
    if (!template || !textareaRef.current) return
    const ta = textareaRef.current
    const start = ta.selectionStart
    const end   = ta.selectionEnd
    const text  = template.processedText
    const newText = text.slice(0, start) + `{{${key}}}` + text.slice(end)
    setTemplate({ ...template, processedText: newText })
    // 커서를 삽입 후 위치로
    setTimeout(() => {
      ta.selectionStart = ta.selectionEnd = start + key.length + 4
      ta.focus()
    }, 0)
  }

  function addField() {
    if (!template || !newFieldKey || !newFieldLabel) return
    const key = newFieldKey.trim().replace(/\s+/g, '_').toLowerCase()
    if (template.fields.find(f => f.key === key)) {
      setError(`키 '${key}'가 이미 존재합니다.`)
      return
    }
    const newField: PlaceholderField = { key, label: newFieldLabel, type: newFieldType, required: false }
    setTemplate({ ...template, fields: [...template.fields, newField] })
    setNewFieldKey('')
    setNewFieldLabel('')
    setNewFieldType('text')
    setAddingField(false)
    // 커서 위치에 자동 삽입
    insertPlaceholderAtCursor(key)
  }

  const steps = ['업로드', 'AI 분석', '검토·수정', '완료']
  const stepIdx = { upload: 0, analyzing: 1, review: 2, done: 3 }[step]

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-1">관리자 — 신청서 등록</h1>
        <p className="text-gray-500 text-sm">hwpx 파일을 업로드하면 AI가 치환자를 자동 생성합니다.</p>
      </div>

      {/* 스텝 인디케이터 */}
      <div className="flex items-center gap-2 mb-8">
        {steps.map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`step-dot ${i < stepIdx ? 'bg-green-500 text-white' : i === stepIdx ? 'bg-brand-600 text-white' : 'bg-gray-200 text-gray-400'}`}>
              {i < stepIdx ? '✓' : i + 1}
            </div>
            <span className={`text-xs ${i === stepIdx ? 'font-semibold text-gray-900' : 'text-gray-400'}`}>{s}</span>
            {i < steps.length - 1 && <div className={`w-8 h-px ${i < stepIdx ? 'bg-green-400' : 'bg-gray-200'}`} />}
          </div>
        ))}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* STEP: 업로드 */}
      {step === 'upload' && (
        <div className="card p-6 max-w-xl">
          <div className="mb-4">
            <label className="label">신청서 제목</label>
            <input className="input" value={title} onChange={e => setTitle(e.target.value)} placeholder="예) 2026년 장학금 신청서" />
          </div>
          <div className="mb-4">
            <label className="label">참조 이미지 (선택, 여러 장 가능)</label>
            <p className="text-xs text-gray-500 mb-2">
              신청서에서 입력해야 할 페이지만 PNG/JPEG로 저장해 순서대로 선택하세요. hwpx 1개에 이미지 여러 장을 매칭합니다.
            </p>
            <div
              className="border border-dashed border-gray-300 rounded-xl p-4 text-center cursor-pointer hover:border-brand-400 hover:bg-brand-50 transition-colors"
              onClick={() => imageInputRef.current?.click()}
            >
              <input
                ref={imageInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                className="hidden"
                onChange={handleReferenceImagesChange}
              />
              {referenceImages.length > 0 ? (
                <p className="text-sm font-medium">{referenceImages.length}장 선택됨 · 다시 클릭해 변경</p>
              ) : (
                <p className="text-sm text-gray-600">클릭하여 이미지 추가 (비워두면 기존 방식만 사용)</p>
              )}
            </div>
          </div>
          <div className="mb-6">
            <label className="label">hwpx 파일</label>
            <div
              className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center cursor-pointer hover:border-brand-400 hover:bg-brand-50 transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <input ref={fileInputRef} type="file" accept=".hwpx,.hwp" className="hidden" onChange={handleFileChange} />
              {file ? (
                <div>
                  <div className="text-2xl mb-2">📄</div>
                  <p className="font-medium text-sm">{file.name}</p>
                  <p className="text-xs text-gray-400 mt-1">{(file.size / 1024).toFixed(1)} KB</p>
                </div>
              ) : (
                <div>
                  <div className="text-3xl mb-3">⬆️</div>
                  <p className="text-sm text-gray-600 font-medium">클릭하여 hwpx 파일 업로드</p>
                  <p className="text-xs text-gray-400 mt-1">.hwpx 파일 지원</p>
                </div>
              )}
            </div>
          </div>
          <button className="btn-primary w-full justify-center" disabled={!file || !title} onClick={handleUpload}>
            Claude AI로 분석 시작
          </button>
        </div>
      )}

      {/* STEP: 분석중 */}
      {step === 'analyzing' && (
        <div className="card p-12 max-w-xl text-center">
          <div className="inline-block w-10 h-10 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin mb-6" />

          {/* 진행 메시지 */}
          <p className="font-semibold mb-2">Claude AI가 신청서를 분석 중입니다...</p>
          <p className="text-sm text-brand-600 mb-6 min-h-[20px] transition-all">{ANALYZING_MESSAGES[msgIdx]}</p>

          {/* 진행 바 */}
          <div className="w-full bg-gray-100 rounded-full h-1.5 mb-3 overflow-hidden">
            <div
              className="h-1.5 bg-brand-500 rounded-full transition-all duration-1000"
              style={{ width: `${Math.min((elapsed / 30) * 100, 95)}%` }}
            />
          </div>

          {/* 소요 시간 */}
          <p className="text-xs text-gray-400">
            {Math.floor(elapsed / 60) > 0 && `${Math.floor(elapsed / 60)}분 `}
            {elapsed % 60}초 경과 · 보통 20~40초 소요
          </p>
        </div>
      )}

      {/* STEP: 검토·수정 */}
      {step === 'review' && template && (
        <div className="grid grid-cols-2 gap-6 items-start">

          {/* 왼쪽: processedText 직접 편집 */}
          <div className="sticky top-[72px]">
            <div className="flex items-center justify-between mb-2">
              <label className="label mb-0">문서 편집</label>
              <span className="text-xs text-gray-400">치환자 위치에 커서를 놓고 오른쪽에서 필드 삽입</span>
            </div>
            {/* 하이라이트 미리보기 */}
            <div className="card p-3 text-xs leading-7 whitespace-pre-wrap max-h-[220px] overflow-y-auto text-gray-700 bg-gray-50 mb-2">
              {template.processedText.split(/(\{\{[^}]+\}\})/g).map((part, i) => {
                const m = part.match(/^\{\{([^}]+)\}\}$/)
                if (m) {
                  const field = template.fields.find(f => f.key === m[1])
                  return (
                    <span key={i} className="inline-block bg-brand-100 border border-brand-300 text-brand-700 rounded px-1 mx-0.5 font-medium">
                      {field ? field.label : m[1]}
                    </span>
                  )
                }
                return <span key={i}>{part}</span>
              })}
            </div>
            {/* 직접 편집 textarea */}
            <textarea
              ref={textareaRef}
              className="input font-mono text-xs leading-relaxed resize-none"
              rows={16}
              value={template.processedText}
              onChange={e => setTemplate({ ...template, processedText: e.target.value })}
              placeholder="문서 텍스트를 직접 수정하세요. {{key}} 형태로 치환자를 삽입할 수 있습니다."
              spellCheck={false}
            />
            <p className="text-xs text-gray-400 mt-1">직접 <code className="bg-gray-100 px-1 rounded">{'{{key}}'}</code> 형태로 입력하거나, 오른쪽 필드의 삽입 버튼을 사용하세요.</p>
          </div>

          {/* 오른쪽: 치환자 목록 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="label mb-0">치환자 목록 {template.fields.length}개</label>
              <button
                className="text-xs px-2 py-1 rounded-lg bg-brand-600 text-white hover:bg-brand-700 transition-colors"
                onClick={() => setAddingField(v => !v)}
              >
                + 필드 추가
              </button>
            </div>

            {/* 새 필드 추가 폼 */}
            {addingField && (
              <div className="card p-3 mb-3 bg-brand-50 border-brand-200 space-y-2">
                <p className="text-xs font-semibold text-brand-700">새 치환자 추가</p>
                <input
                  className="input py-1 text-xs"
                  placeholder="키 (영문 snake_case, 예: applicant_name)"
                  value={newFieldKey}
                  onChange={e => setNewFieldKey(e.target.value.replace(/\s+/g, '_').toLowerCase())}
                />
                <input
                  className="input py-1 text-xs"
                  placeholder="레이블 (한국어, 예: 신청인 성명)"
                  value={newFieldLabel}
                  onChange={e => setNewFieldLabel(e.target.value)}
                />
                <div className="flex gap-1.5">
                  {(['text', 'date', 'select', 'textarea'] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => setNewFieldType(t)}
                      className={`text-xs px-2 py-0.5 rounded border transition-colors ${newFieldType === t ? 'bg-brand-600 text-white border-brand-600' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button
                    className="btn-primary text-xs py-1 flex-1 justify-center"
                    onClick={addField}
                    disabled={!newFieldKey || !newFieldLabel}
                  >
                    추가 + 커서 위치에 삽입
                  </button>
                  <button className="btn-secondary text-xs py-1" onClick={() => setAddingField(false)}>취소</button>
                </div>
              </div>
            )}

            <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
              {template.fields.map((f, i) => (
                <div key={f.key} className="card p-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="chip text-xs">{`{{${f.key}}}`}</span>
                    <div className="flex gap-1">
                      <button
                        className="text-xs px-2 py-0.5 rounded border border-brand-200 text-brand-600 hover:bg-brand-50 transition-colors"
                        onClick={() => insertPlaceholderAtCursor(f.key)}
                        title="커서 위치에 삽입"
                      >
                        ↙ 삽입
                      </button>
                      <button
                        className="text-xs px-2 py-0.5 rounded border border-red-200 text-red-500 hover:bg-red-50 transition-colors"
                        onClick={() => deleteField(i)}
                        title="필드 삭제"
                      >
                        삭제
                      </button>
                    </div>
                  </div>
                  <input
                    className="input py-1 text-xs"
                    value={f.label}
                    onChange={e => updateField(i, { label: e.target.value })}
                    placeholder="레이블"
                  />
                  <div className="flex gap-1.5 flex-wrap">
                    {(['text', 'date', 'select', 'textarea'] as const).map(t => (
                      <button
                        key={t}
                        onClick={() => updateField(i, { type: t })}
                        className={`text-xs px-2 py-0.5 rounded border transition-colors ${f.type === t ? 'bg-brand-600 text-white border-brand-600' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                  {f.type === 'select' && (
                    <input
                      className="input py-1 text-xs"
                      value={(f.options || []).join(', ')}
                      onChange={e => updateField(i, { options: e.target.value.split(',').map(s => s.trim()) })}
                      placeholder="선택지를 쉼표로 구분"
                    />
                  )}
                </div>
              ))}
            </div>

            <div className="mt-4 flex gap-2">
              <button className="btn-primary flex-1 justify-center" onClick={handleSave} disabled={saving}>
                {saving ? '저장 중...' : '✓ 확정 저장'}
              </button>
              <button className="btn-secondary" onClick={() => { setStep('upload'); setTemplate(null); setReferenceImages([]) }}>
                다시 업로드
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STEP: 완료 */}
      {step === 'done' && template && (
        <div className="card p-8 max-w-xl text-center">
          <div className="text-4xl mb-4">✅</div>
          <h2 className="text-xl font-bold mb-2">신청서가 등록되었습니다!</h2>
          <p className="text-gray-500 text-sm mb-1">
            <span className="font-medium text-gray-800">{template.title}</span>
          </p>
          <p className="text-gray-400 text-xs mb-2">치환자 {template.fields.length}개 생성 완료</p>
          {listedTemplateCount !== null && (
            <p className="text-xs text-brand-600 mb-6">
              이 서버에 등록된 신청서 총 {listedTemplateCount}건 — 작성 페이지에서 같은 수가 보여야 합니다.
            </p>
          )}
          {listedTemplateCount === null && <div className="mb-6" />}
          <div className="flex gap-3 justify-center">
            <a href="/apply" className="btn-primary">신청서 작성 페이지 →</a>
            <button className="btn-secondary" onClick={() => { setStep('upload'); setFile(null); setTitle(''); setTemplate(null); setReferenceImages([]) }}>
              새 신청서 등록
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
