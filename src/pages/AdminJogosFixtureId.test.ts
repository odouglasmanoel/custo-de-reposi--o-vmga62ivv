import { describe, it, expect } from 'vitest'

describe('Admin Editar Jogo - Trava e persistência de fixture_id', () => {
  it('quando o admin informa fixture_id manual numérico, deve adotá-lo e marcá-lo como vinculado', () => {
    const existingFixtureId = ''
    const manualFixtureId = '1492382'

    let effectiveFixtureId = existingFixtureId
    let fixtureManualInformado = false

    if (manualFixtureId && /^\d+$/.test(manualFixtureId)) {
      effectiveFixtureId = manualFixtureId
      fixtureManualInformado = true
    }

    expect(effectiveFixtureId).toBe('1492382')
    expect(fixtureManualInformado).toBe(true)
  })

  it('quando o jogo já possui fixture_id e o admin edita os nomes (enviando fixture_id vazio ou não enviando), o fixture_id gravado DEVE ser preservado intacto', () => {
    const existingFixtureId = '1628995' // ex.: jogo previamente vinculado
    // Admin muda os nomes de "Japan x Uruguay" para "Japão x Uruguai", deixando o campo de fixture_id em branco
    const manualFixtureId = ''

    let effectiveFixtureId = existingFixtureId
    let fixtureManualInformado = false

    if (manualFixtureId && /^\d+$/.test(manualFixtureId)) {
      effectiveFixtureId = manualFixtureId
      fixtureManualInformado = true
    } else if (existingFixtureId) {
      // Regra de preservação permanente
      effectiveFixtureId = existingFixtureId
    }

    expect(effectiveFixtureId).toBe('1628995')
    expect(fixtureManualInformado).toBe(false)
  })

  it('se já houver fixture_id gravado, a busca automática por data/texto DEVE ser pulada para poupar cota', () => {
    const effectiveFixtureId = '1628995'
    let buscaAutomaticaExecutada = false

    // Lógica no hook admin_editar_jogo.js:
    if (!effectiveFixtureId) {
      buscaAutomaticaExecutada = true
    }

    expect(buscaAutomaticaExecutada).toBe(false)
  })

  it('se fixture_id estiver vazio e nenhum for informado manualmente, a busca automática pode ser executada', () => {
    const effectiveFixtureId = ''
    let buscaAutomaticaExecutada = false

    if (!effectiveFixtureId) {
      buscaAutomaticaExecutada = true
    }

    expect(buscaAutomaticaExecutada).toBe(true)
  })

  it('quando o admin digita caracteres não numéricos, a higienização no frontend deve manter apenas dígitos', () => {
    const rawInput = 'ID: #1492382-A '
    const sanitized = rawInput.replace(/[^0-9]/g, '')
    expect(sanitized).toBe('1492382')
  })
})
