'use client'

import { useState, useRef, useEffect } from 'react'
import type { FormTemplate, PlaceholderField } from '@/lib/types'

type Step = 'upload' | 'analyzing' | 'review' | 'done'

const ANALYZING_MESSAGES = [
  'hwpx 파일에서 텍스트를 추출하고 있습니다...',
  'Claude AI가 문서 구조를 파악하고 있습니다...',
  '빈칸과 입력 필드를 감지하고 있습니다...',
  '치환자 키를 생성하고 있습니다...',
  '거의 다 됐습니다...',
]

export default function AdminPage() {
  const [step, setStep]             = useState<Step>('upload')
  const [title, setTitle]           = useState('')
  const [file, setFile]             = useState<File | null>(null)
  const [template, setTemplate]     = useState<FormTemplate | null>(null)
  const [error, setError]           = useState<string | null>(null)
  const [saving, setSaving]         = useState(false)
  const [elapsed, setElapsed]       = useState(0)
  const [msgIdx, setMsgIdx]         = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null)
  const msgTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null)

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

  async function handleUpload() {
    if (!file) return
    setStep('analyzing')
    setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('title', title)
      const res  = await fetch('/api/upload', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '업로드 실패')
      setTemplate(data)
      setStep('review')
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류 발생')
      setStep('upload')
    }
  }

  async function handleSave() {
    if (!template) return
    setSaving(true)
    try {
      await fetch(`/api/templates/${template.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: template.fields, processedText: template.processedText, title }),
      })
      setStep('done')
    } catch {
      setError('저장 실패')
    }
    setSaving(false)
  }

  function updateField(i: number, patch: Partial<PlaceholderField>) {
    if (!template) return
    const fields = [...template.fields]
    fields[i] = { ...fields[i], ...patch }
    setTemplate({ ...template, fields })
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
        <div className="grid grid-cols-2 gap-6">
          {/* 왼쪽: 미리보기 */}
          <div>
            <label className="label">처리된 문서 미리보기</label>
            <div className="card p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap max-h-[500px] overflow-y-auto text-gray-700">
              {template.processedText.replace(/\{\{([^}]+)\}\}/g, '[$1]')}
            </div>
          </div>

          {/* 오른쪽: 치환자 목록 */}
          <div>
            <label className="label">감지된 치환자 {template.fields.length}개 — 레이블 수정 가능</label>
            <div className="space-y-2 max-h-[440px] overflow-y-auto pr-1">
              {template.fields.map((f, i) => (
                <div key={f.key} className="card p-3 flex items-start gap-3">
                  <span className="chip mt-0.5">{`{{${f.key}}}`}</span>
                  <div className="flex-1 space-y-1.5">
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
                </div>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <button className="btn-primary flex-1 justify-center" onClick={handleSave} disabled={saving}>
                {saving ? '저장 중...' : '✓ 확정 저장'}
              </button>
              <button className="btn-secondary" onClick={() => { setStep('upload'); setTemplate(null) }}>
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
          <p className="text-gray-400 text-xs mb-6">치환자 {template.fields.length}개 생성 완료</p>
          <div className="flex gap-3 justify-center">
            <a href="/apply" className="btn-primary">신청서 작성 페이지 →</a>
            <button className="btn-secondary" onClick={() => { setStep('upload'); setFile(null); setTitle(''); setTemplate(null) }}>
              새 신청서 등록
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
