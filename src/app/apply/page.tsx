'use client'

import { useState, useEffect, useRef } from 'react'
import type { FormTemplate, PlaceholderField } from '@/lib/types'

export default function ApplyPage() {
  const [templates, setTemplates]     = useState<FormTemplate[]>([])
  const [selected, setSelected]       = useState<FormTemplate | null>(null)
  const [values, setValues]           = useState<Record<string, string>>({})
  const [loading, setLoading]         = useState(true)
  const [downloading, setDownloading] = useState(false)
  const [downloadingTemplate, setDownloadingTemplate] = useState(false)
  const [showPreview, setShowPreview] = useState(true)
  const [activeKey, setActiveKey]     = useState<string | null>(null)
  const [error, setError]             = useState<string | null>(null)
  const [listRefreshing, setListRefreshing] = useState(false)
  const previewRef = useRef<HTMLDivElement>(null)

  async function loadTemplates() {
    setListRefreshing(true)
    setError(null)
    try {
      const res = await fetch('/api/templates', { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error || `목록 로드 실패 (${res.status})`)
        setTemplates([])
        return
      }
      if (Array.isArray(data)) {
        setTemplates(data)
      } else {
        setError(data?.error || '목록 로드 실패')
        setTemplates([])
      }
    } catch {
      setError('목록 로드 실패 — 네트워크 또는 서버 오류')
      setTemplates([])
    } finally {
      setLoading(false)
      setListRefreshing(false)
    }
  }

  useEffect(() => {
    loadTemplates()
  }, [])

  function selectTemplate(t: FormTemplate) {
    setSelected(t)
    setValues({})
    setActiveKey(null)
  }

  function setValue(key: string, val: string) {
    setValues(prev => ({ ...prev, [key]: val }))
  }

  // 미리보기: processedText를 파싱해 치환자 위치에 하이라이트/값 표시
  function renderPreview(template: FormTemplate, vals: Record<string, string>, active: string | null) {
    const text = template.processedText
    const parts: React.ReactNode[] = []
    const regex = /\{\{([^}]+)\}\}/g
    let last = 0
    let match: RegExpExecArray | null

    while ((match = regex.exec(text)) !== null) {
      // 치환자 앞 일반 텍스트
      if (match.index > last) {
        parts.push(
          <span key={last}>{text.slice(last, match.index)}</span>
        )
      }
      const key = match[1]
      const field = template.fields.find(f => f.key === key)
      const val = vals[key]
      const isActive = active === key

      parts.push(
        <span
          key={match.index}
          className={`inline-block rounded px-1 mx-0.5 text-sm font-medium border transition-all cursor-pointer ${
            val
              ? 'bg-green-50 border-green-300 text-green-800'
              : isActive
              ? 'bg-brand-100 border-brand-400 text-brand-800 ring-2 ring-brand-300'
              : 'bg-yellow-50 border-yellow-300 text-yellow-700'
          }`}
          title={field?.label || key}
        >
          {val || `${field?.label || key}`}
        </span>
      )
      last = match.index + match[0].length
    }
    if (last < text.length) {
      parts.push(<span key={last}>{text.slice(last)}</span>)
    }
    return parts
  }

  // 활성 필드로 미리보기 스크롤
  useEffect(() => {
    if (!activeKey || !previewRef.current) return
    const el = previewRef.current.querySelector(`[title]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [activeKey])

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

  /** 입력 없이 Storage에 심어 둔 치환자 그대로 확인용 */
  async function handleDownloadTemplateOnly() {
    if (!selected) return
    setDownloadingTemplate(true)
    setError(null)
    try {
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: selected.id, values: {} }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error)
      }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `${selected.title}_양식_치환자포함.hwpx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : '다운로드 실패')
    }
    setDownloadingTemplate(false)
  }

  const filled = selected ? selected.fields.filter(f => values[f.key]?.trim()).length : 0
  const total  = selected?.fields.length ?? 0
  const progress = total > 0 ? Math.round((filled / total) * 100) : 0

  if (loading) return (
    <div className="flex justify-center py-20">
      <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
    </div>
  )

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold mb-1">신청서 작성</h1>
          <p className="text-gray-500 text-sm">
            관리자에서 <strong>확정 저장</strong>까지 완료한 신청서가 여기 목록에 표시됩니다.
            {!selected && templates.length > 0 && (
              <span className="text-brand-600"> ({templates.length}건)</span>
            )}
          </p>
        </div>
        {!selected && (
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={() => loadTemplates()}
            disabled={listRefreshing}
          >
            {listRefreshing ? '불러오는 중…' : '목록 새로고침'}
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
      )}

      {!selected ? (
        <div>
          {templates.length === 0 ? (
            <div className="card p-12 text-center text-gray-400">
              <div className="text-3xl mb-3">📭</div>
              <p className="text-sm mb-2">등록된 신청서가 없습니다.</p>
              <p className="text-xs text-gray-400 max-w-md mx-auto mb-4">
                관리자 등록은 <strong>배포 URL</strong>의 /admin 에서 하셨는지 확인하세요.
                로컬(localhost)에서만 등록하면 이 배포 페이지에는 보이지 않습니다.
              </p>
              <div className="flex flex-wrap gap-2 justify-center">
                <button type="button" className="btn-secondary" onClick={() => loadTemplates()}>
                  다시 불러오기
                </button>
                <a href="/admin" className="btn-primary inline-flex">관리자에서 등록하기</a>
              </div>
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
        <div>
          {/* 상단 헤더 */}
          <div className="flex items-center justify-between mb-5">
            <button className="btn-secondary" onClick={() => setSelected(null)}>← 목록으로</button>
            <div className="flex items-center gap-3">
              {/* 미리보기 토글 */}
              <button
                className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${showPreview ? 'bg-brand-600 text-white border-brand-600' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
                onClick={() => setShowPreview(v => !v)}
              >
                {showPreview ? '📄 미리보기 닫기' : '📄 미리보기 열기'}
              </button>
              <button
                className="btn-secondary text-sm"
                onClick={handleDownloadTemplateOnly}
                disabled={downloadingTemplate || downloading}
                title="입력 전 · XML에 심어 둔 {{치환자}} 그대로 확인"
              >
                {downloadingTemplate ? '받는 중…' : '📋 양식만 받기 (치환자 확인)'}
              </button>
              <button
                className="btn-primary"
                onClick={handleDownload}
                disabled={downloading || downloadingTemplate}
              >
                {downloading ? (
                  <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />생성 중...</>
                ) : '⬇ hwpx 다운로드'}
              </button>
            </div>
          </div>

          {/* 진행률 바 */}
          <div className="mb-5">
            <div className="flex justify-between text-xs text-gray-400 mb-1">
              <span>{selected.title}</span>
              <span>{filled} / {total} 입력됨</span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
              <div
                className="h-1.5 bg-brand-500 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          <div className={`grid gap-6 items-start ${showPreview ? 'grid-cols-2' : 'grid-cols-1 max-w-xl'}`}>
            {/* 왼쪽: 입력 폼 (스크롤) */}
            <div className="space-y-4">
              {selected.fields.map((f: PlaceholderField) => (
                <div
                  key={f.key}
                  className={`p-3 rounded-xl border transition-all ${activeKey === f.key ? 'border-brand-400 bg-brand-50/50 shadow-sm' : 'border-transparent'}`}
                >
                  <label className="label">
                    {f.label}
                  </label>
                  {f.type === 'textarea' ? (
                    <textarea
                      className="input resize-none"
                      rows={3}
                      value={values[f.key] || ''}
                      onChange={e => setValue(f.key, e.target.value)}
                      onFocus={() => setActiveKey(f.key)}
                      onBlur={() => setActiveKey(null)}
                      placeholder={`${f.label}을 입력하세요`}
                    />
                  ) : f.type === 'select' ? (
                    <select
                      className="input"
                      value={values[f.key] || ''}
                      onChange={e => setValue(f.key, e.target.value)}
                      onFocus={() => setActiveKey(f.key)}
                      onBlur={() => setActiveKey(null)}
                    >
                      <option value="">선택하세요</option>
                      {(f.options || []).map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input
                      className="input"
                      type={f.type}
                      value={values[f.key] || ''}
                      onChange={e => setValue(f.key, e.target.value)}
                      onFocus={() => setActiveKey(f.key)}
                      onBlur={() => setActiveKey(null)}
                      placeholder={f.type !== 'date' ? `${f.label}을 입력하세요` : undefined}
                    />
                  )}
                </div>
              ))}
            </div>

            {/* 오른쪽: 실시간 문서 미리보기 — sticky 고정 */}
            {showPreview && (
              <div className="sticky top-[72px]">
                <div className="flex items-center gap-2 mb-2">
                  <label className="label mb-0">문서 미리보기</label>
                  <div className="flex gap-2 text-xs text-gray-400">
                    <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-yellow-100 border border-yellow-300" />미입력</span>
                    <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-green-100 border border-green-300" />입력됨</span>
                    <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-brand-100 border border-brand-400" />현재 필드</span>
                  </div>
                </div>
                <div
                  ref={previewRef}
                  className="card p-5 text-sm leading-8 whitespace-pre-wrap overflow-y-auto text-gray-700 bg-white"
                  style={{ fontFamily: "'Malgun Gothic', '맑은 고딕', sans-serif", maxHeight: 'calc(100vh - 200px)' }}
                >
                  {renderPreview(selected, values, activeKey)}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
