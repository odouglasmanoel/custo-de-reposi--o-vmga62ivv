import { describe, it, expect } from 'vitest'
import { normalizarLogin, REPRESS_EMAIL_DOMAIN } from './loginUtils'

describe('normalizarLogin', () => {
  it('concatena @repress.com.br para login simples minúsculo sem @', () => {
    expect(normalizarLogin('brunol')).toBe('brunol@repress.com.br')
    expect(normalizarLogin('brunox')).toBe('brunox@repress.com.br')
    expect(normalizarLogin('gabriel')).toBe('gabriel@repress.com.br')
    expect(normalizarLogin('davi')).toBe('davi@repress.com.br')
  })

  it('normaliza com trim() e lowercase() para entradas com espaços e maiúsculas', () => {
    expect(normalizarLogin('BRUNOL ')).toBe('brunol@repress.com.br')
    expect(normalizarLogin('  BrunoX  ')).toBe('brunox@repress.com.br')
    expect(normalizarLogin('  GABRIEL')).toBe('gabriel@repress.com.br')
    expect(normalizarLogin('Davi ')).toBe('davi@repress.com.br')
  })

  it('mantém e-mails completos com @ intactos/normalizados (ex.: Douglas)', () => {
    expect(normalizarLogin('douglas.manoel@repress.com.br')).toBe('douglas.manoel@repress.com.br')
    expect(normalizarLogin('  DOUGLAS.MANOEL@repress.com.br  ')).toBe(
      'douglas.manoel@repress.com.br',
    )
    expect(normalizarLogin('Douglas.Manoel@Repress.com.br')).toBe('douglas.manoel@repress.com.br')
  })

  it('trata entradas vazias ou em branco retornando string vazia', () => {
    expect(normalizarLogin('')).toBe('')
    expect(normalizarLogin('   ')).toBe('')
  })

  it('trata caso limite com @ no final anexando o domínio padrão', () => {
    expect(normalizarLogin('brunol@')).toBe('brunol@repress.com.br')
  })

  it('exporta a constante REPRESS_EMAIL_DOMAIN corretamente', () => {
    expect(REPRESS_EMAIL_DOMAIN).toBe('@repress.com.br')
  })
})
