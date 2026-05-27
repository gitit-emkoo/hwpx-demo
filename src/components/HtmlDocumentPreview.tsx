'use client'

import { useMemo } from 'react'
import type { FormTemplate } from '@/lib/types'
import { parsePlaceholderInner } from '@/lib/placeholder-fields'
import { resolvePdfPlaceholder } from '@/lib/pdf-rules-embed'
import { patchEquipmentPlanPreviewHtml } from '@/lib/preview-html'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function displayForEmbed(inner: string, fields: FormTemplate['fields']): string {
  const p = parsePlaceholderInner(inner)
  const f = fields.find(x => x.key === p.baseKey)
  const name = f?.label || p.baseKey.split('_').slice(1).join('_') || p.baseKey
  if (p.type === 'part') return `[${p.part || '날짜'}]`
  if (p.type === 'select') return `○ ${p.option}`
  if (p.type === 'checkbox') return `□ ${p.option}`
  return `「${name}」`
}

type Props = {
  html: string
  template: FormTemplate
  values?: Record<string, string>
  activeKey?: string | null
  onFieldClick?: (baseKey: string) => void
  variant?: 'embed' | 'filled'
}

export default function HtmlDocumentPreview({
  html,
  template,
  values = {},
  activeKey = null,
  onFieldClick,
  variant = 'filled',
}: Props) {
  const renderedHtml = useMemo(() => {
    const isEmbed = variant === 'embed'
    const baseHtml = patchEquipmentPlanPreviewHtml(html, template.processedText)
    return baseHtml.replace(/\{\{([^}]+)\}\}/g, (_full, inner: string) => {
      const baseKey = inner.split('#')[0]
      const isActive = activeKey === baseKey || activeKey === inner
      const activeCls = isActive ? ' doc-field--active' : ''

      if (isEmbed) {
        const chip = escapeHtml(displayForEmbed(inner, template.fields))
        const click = onFieldClick
          ? ` role="button" tabindex="0" data-field-key="${escapeHtml(baseKey)}"`
          : ''
        return `<span class="doc-field doc-field--embed${activeCls}"${click} title="{{${escapeHtml(inner)}}}">${chip}</span>`
      }

      const display = resolvePdfPlaceholder(inner, values, escapeHtml)
      const filled = Boolean(values[baseKey]?.trim()) || inner.includes('#select#') || inner.includes('#checkbox#')
      const cls = filled ? 'doc-field--filled' : 'doc-field--empty'
      const click = onFieldClick
        ? ` role="button" tabindex="0" data-field-key="${escapeHtml(baseKey)}"`
        : ''
      return `<span class="doc-field ${cls}${activeCls}"${click} title="{{${escapeHtml(inner)}}}">${display}</span>`
    })
  }, [html, template.processedText, template.fields, values, activeKey, variant, onFieldClick])

  return (
    <div className="doc-preview-shell">
      <div
        className="doc-preview-page ai-preview-html"
        dangerouslySetInnerHTML={{ __html: renderedHtml }}
        onClick={e => {
          const el = (e.target as HTMLElement).closest('[data-field-key]')
          if (el && onFieldClick) {
            const key = el.getAttribute('data-field-key')
            if (key) onFieldClick(key)
          }
        }}
        onKeyDown={e => {
          if (e.key !== 'Enter') return
          const el = (e.target as HTMLElement).closest('[data-field-key]')
          if (el && onFieldClick) {
            const key = el.getAttribute('data-field-key')
            if (key) onFieldClick(key)
          }
        }}
      />
    </div>
  )
}
