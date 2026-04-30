'use client'

import { useState, useEffect } from 'react'
import type { FormTemplate } from '@/lib/types'

export default function ApplyPage() {
  const [templates, setTemplates]   = useState<FormTemplate[]>([])
  const [selected, setSelected]     = useState<FormTemplate | null>(null)
  const [values, setValues]         = useState<Record<string, string>>({})
  const [loading, setLoading]       = useState(true)
  const [downloading, setDownloading] = useState(false)
  const [preview, setPreview]       = useState(false)
  const [error, setError]           = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/templates')
      .then(r => r.json())
      .then(data => { setTemplates(data); setLoading(false) })
      .catch(() => { setError('목록 로드 실패'); setLoading(false) })
  }, [])

  function selectTemplate(t: FormTemplate) {
    setSelected(t)
    setValues({})
    setPreview(false)
  }

  function setValue(key: string, val: string) {
    setValues(prev => ({ ...prev, [key]: val }))
  }

  function getPreviewText() {
    if (!selected) return ''
    let text = selected.processedText
    selected.fields.forEach(f => {
      text = text.split(`{{${f.key}}}`).join(values[f.key] || `[${f.label}]`)
    })
    return text
  }

  async function handleDownload() {
    if (!selected) return
    setDownloading(true)
    setError(null)
    try {
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: selected.id, values }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error)
      }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `${selected.title}_작성완료.hwpx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : '다운로드 실패')
    }
    setDownloading(false)
  }

  const filled = selected ? selected.fields.filter(f => !f.required || values[f.key]).length : 0

  if (loading) return (
    <div className="flex justify-center py-20">
      <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
    </div>
  )

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-1">신청서 작성</h1>
        <p className="text-gray-500 text-sm">신청서를 선택하고 내용을 입력한 후 hwpx 파일로 다운로드하세요.</p>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
      )}

      {!selected ? (
        /* 신청서 목록 */
        <div>
          {templates.length === 0 ? (
            <div className="card p-12 text-center text-gray-400">
              <div className="text-3xl mb-3">📭</div>
              <p className="text-sm">등록된 신청서가 없습니다.</p>
              <a href="/admin" className="btn-secondary mt-4 inline-flex">관리자에서 등록하기</a>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {templates.map(t => (
                <div key={t.id} className="card p-5 cursor-pointer hover:shadow-md hover:border-brand-300 transition-all" onClick={() => selectTemplate(t)}>
                  <div className="flex items-start justify-between mb-3">
                    <div className="text-2xl">📄</div>
                    <span className="text-xs bg-brand-50 text-brand-600 px-2 py-0.5 rounded-full font-medium">
                      입력 {t.fields?.length ?? 0}개
                    </span>
                  </div>
                  <h3 className="font-semibold text-sm mb-1">{t.title}</h3>
                  <p className="text-xs text-gray-400">{new Date(t.createdAt).toLocaleDateString('ko-KR')}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* 폼 작성 화면 */
        <div>
          <button className="btn-secondary mb-6" onClick={() => setSelected(null)}>
            ← 목록으로
          </button>

          <div className="grid grid-cols-2 gap-6">
            {/* 왼쪽: 입력 폼 */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-lg">{selected.title}</h2>
                <span className="text-xs text-gray-400">{filled} / {selected.fields.length} 입력됨</span>
              </div>

              <div className="space-y-4">
                {selected.fields.map(f => (
                  <div key={f.key}>
                    <label className="label">
                      {f.label}
                      {f.required && <span className="text-red-400 ml-0.5">*</span>}
                    </label>
                    {f.type === 'textarea' ? (
                      <textarea
                        className="input resize-none"
                        rows={3}
                        value={values[f.key] || ''}
                        onChange={e => setValue(f.key, e.target.value)}
                        placeholder={`${f.label}을 입력하세요`}
                      />
                    ) : f.type === 'select' ? (
                      <select className="input" value={values[f.key] || ''} onChange={e => setValue(f.key, e.target.value)}>
                        <option value="">선택하세요</option>
                        {(f.options || []).map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input
                        className="input"
                        type={f.type}
                        value={values[f.key] || ''}
                        onChange={e => setValue(f.key, e.target.value)}
                        placeholder={f.type !== 'date' ? `${f.label}을 입력하세요` : undefined}
                      />
                    )}
                  </div>
                ))}
              </div>

              <div className="mt-6 flex gap-2">
                <button className="btn-secondary" onClick={() => setPreview(!preview)}>
                  {preview ? '미리보기 닫기' : '미리보기'}
                </button>
                <button
                  className="btn-primary flex-1 justify-center"
                  onClick={handleDownload}
                  disabled={downloading}
                >
                  {downloading ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      생성 중...
                    </>
                  ) : '⬇ hwpx 다운로드'}
                </button>
              </div>
            </div>

            {/* 오른쪽: 미리보기 */}
            <div>
              <label className="label">문서 미리보기</label>
              <div className="card p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap max-h-[580px] overflow-y-auto text-gray-700 bg-gray-50">
                {preview ? getPreviewText() : (
                  <span className="text-gray-400 italic">미리보기 버튼을 누르면 작성된 내용이 반영된 문서를 확인할 수 있습니다.</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
