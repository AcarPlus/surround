import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'

class Failed extends ErrorBoundary {
  state = { error: new Error('boom') }
}

describe('ErrorBoundary', () => {
  it('getDerivedStateFromError hatayı saklar', () => {
    expect(ErrorBoundary.getDerivedStateFromError(new Error('x')).error.message).toBe('x')
  })
  it('sağlamken çocuğu gösterir', () => {
    expect(renderToStaticMarkup(createElement(ErrorBoundary, { compact: true, children: null }, createElement('b', null, 'ok')))).toBe('<b>ok</b>')
  })
  it('compact: küçük "Bu bölüm açılamadı — Yeniden dene" yedeği', () => {
    const html = renderToStaticMarkup(createElement(Failed, { compact: true, children: null }, createElement('b', null, 'ok')))
    expect(html).toContain('Bu bölüm açılamadı')
    expect(html).toContain('Yeniden dene')
    expect(html).not.toContain('<b>ok</b>')
  })
  it('compact olmayan tam ekran yedeği', () => {
    expect(renderToStaticMarkup(createElement(Failed, { children: 'x' }))).toContain('Bu ekran açılamadı')
  })
})
