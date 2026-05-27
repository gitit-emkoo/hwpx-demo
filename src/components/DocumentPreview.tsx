'use client'

import { useMemo } from 'react'
import type { FormTemplate } from '@/lib/types'
import { parsePlaceholderInner } from '@/lib/placeholder-fields'

type Block =
  | { kind: 'title'; text: string }
  | { kind: 'section'; text: string }
  | { kind: 'row'; label: string; valueLine: string }
  | { kind: 'body'; line: string }

function isSectionLine(line: string): boolean {
  const t = line.trim()
  if (t.includes('{{')) return false
  if (/^[\d.]+\s*\S{2,}/.test(t) && t.length < 45) return true
  if (/^(기업\s*개요|대표자|장비|개인정보|첨부|판로|서약)/.test(t) && t.length < 40) return true
  return false
}

function parseBlocks(text: string): Block[] {
  const lines = text.split('\n')
  const blocks: Block[] = []
  let i = 0

  while (i < lines.length) {
    const raw = lines[i]
    const line = raw.trim()
    if (!line) {
      i++
      continue
    }

    if (blocks.length === 0 && !line.includes('{{') && line.length >= 8) {
      blocks.push({ kind: 'title', text: line })
      i++
      continue
    }

    if (isSectionLine(line)) {
      blocks.push({ kind: 'section', text: line })
      i++
      continue
    }

    const next = lines[i + 1]?.trim() ?? ''
    if (
      !line.includes('{{') &&
      line.length <= 36 &&
      next.includes('{{') &&
      !/^[\d.]+\s/.test(line)
    ) {
      blocks.push({ kind: 'row', label: line, valueLine: next })
      i += 2
      continue
    }

    blocks.push({ kind: 'body', line: raw })
    i++
  }

  return blocks
}

/** 관리자: 심어진 {{치환자}} 위치 표시 */
function displayForEmbed(inner: string, fields: FormTemplate['fields']): string {
  const p = parsePlaceholderInner(inner)
  const f = fields.find(x => x.key === p.baseKey)
  const name = f?.label || p.baseKey.split('_').slice(1).join('_') || p.baseKey
  if (p.type === 'part') return `[${p.part || '날짜'}]`
  if (p.type === 'select') return `○ ${p.option}`
  if (p.type === 'checkbox') return `□ ${p.option}`
  return `「${name}」`
}

function displayForPlaceholder(
  inner: string,
  fields: FormTemplate['fields'],
  vals: Record<string, string>
): string {
  const p = parsePlaceholderInner(inner)
  const field = fields.find(f => f.key === p.baseKey)
  const raw = vals[p.baseKey]?.trim()

  if (p.type === 'select' && p.option) {
    const on = raw === p.option
    return `${on ? '☑' : '☐'} ${p.option}`
  }
  if (p.type === 'checkbox' && p.option) {
    const opt = p.option
    const selected = (raw || '').split(/[,，]/).map(s => s.trim()).filter(Boolean)
    const on = selected.some(s => s === opt || s.includes(opt))
    return `${on ? '☑' : '☐'} ${opt}`
  }
  if (p.type === 'part') {
    if (raw) {
      const { y, m, d } = parseDateParts(raw)
      if (p.part === '년') return y || '____'
      if (p.part === '월') return m || '__'
      if (p.part === '일') return d || '__'
    }
    return '____'
  }
  if (raw) return raw
  return field?.label || p.baseKey.split('_').pop() || inner
}

function parseDateParts(raw: string): { y: string; m: string; d: string } {
  const iso = raw.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/)
  if (iso) return { y: iso[1], m: iso[2], d: iso[3] }
  const kr = raw.match(/^(\d{4})\s*년?\s*(\d{1,2})\s*월?\s*(\d{1,2})/)
  if (kr) return { y: kr[1], m: kr[2], d: kr[3] }
  return { y: '', m: '', d: '' }
}

type Props = {
  template: FormTemplate
  values?: Record<string, string>
  activeKey?: string | null
  onFieldClick?: (baseKey: string) => void
  /** embed = 관리자 등록 시 심어진 치환자 위치, filled = 신청자 입력 미리보기 */
  variant?: 'embed' | 'filled'
}

export default function DocumentPreview({
  template,
  values = {},
  activeKey = null,
  onFieldClick,
  variant = 'filled',
}: Props) {
  const blocks = useMemo(() => parseBlocks(template.processedText), [template.processedText])

  function renderLine(line: string, keyPrefix: string) {
    const parts: React.ReactNode[] = []
    const regex = /\{\{([^}]+)\}\}/g
    let last = 0
    let match: RegExpExecArray | null
    let idx = 0

    while ((match = regex.exec(line)) !== null) {
      if (match.index > last) {
        const plain = line.slice(last, match.index)
        if (plain) parts.push(<span key={`${keyPrefix}-t-${idx++}`}>{plain}</span>)
      }
      const inner = match[1]
      const baseKey = inner.split('#')[0]
      const isActive = activeKey === baseKey || activeKey === inner
      const isEmbed = variant === 'embed'

      const display = isEmbed
        ? displayForEmbed(inner, template.fields)
        : displayForPlaceholder(inner, template.fields, values)

      const p = parsePlaceholderInner(inner)
      const filled = isEmbed
        ? false
        : p.type === 'select' || p.type === 'checkbox'
          ? display.startsWith('☑')
          : Boolean(values[baseKey]?.trim())

      const fieldClass = isEmbed
        ? 'doc-field--embed'
        : filled
          ? 'doc-field--filled'
          : 'doc-field--empty'

      parts.push(
        <span
          key={`${keyPrefix}-ph-${match.index}`}
          data-field-key={baseKey}
          role={onFieldClick ? 'button' : undefined}
          tabIndex={onFieldClick ? 0 : undefined}
          onClick={() => onFieldClick?.(baseKey)}
          onKeyDown={e => e.key === 'Enter' && onFieldClick?.(baseKey)}
          className={`doc-field ${fieldClass} ${isActive ? 'doc-field--active' : ''}`}
          title={`{{${inner}}}`}
        >
          {display}
        </span>
      )
      last = match.index + match[0].length
    }
    if (last < line.length) {
      parts.push(<span key={`${keyPrefix}-tail`}>{line.slice(last)}</span>)
    }
    return parts
  }

  return (
    <div className="doc-preview-shell">
      <div className="doc-preview-page">
        {blocks.map((block, bi) => {
          if (block.kind === 'title') {
            return (
              <h1 key={bi} className="doc-title">
                {block.text}
              </h1>
            )
          }
          if (block.kind === 'section') {
            return (
              <h2 key={bi} className="doc-section">
                {block.text}
              </h2>
            )
          }
          if (block.kind === 'row') {
            return (
              <table key={bi} className="doc-table">
                <tbody>
                  <tr>
                    <th className="doc-table-label">{block.label}</th>
                    <td className="doc-table-value">{renderLine(block.valueLine, `r${bi}`)}</td>
                  </tr>
                </tbody>
              </table>
            )
          }
          return (
            <p key={bi} className="doc-paragraph">
              {renderLine(block.line, `b${bi}`)}
            </p>
          )
        })}
      </div>
    </div>
  )
}
