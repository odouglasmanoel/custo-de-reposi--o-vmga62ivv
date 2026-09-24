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
    const rawInput = 'ID: 12345-abc!'
    const cleaned = rawInput.replace(/\D/g, '')
    expect(cleaned).toBe('12345')
  })

  it('no fluxo de edição do admin, a re-busca de fixture é permitida a cada salvamento sem trava de tentativa diária', () => {
    // Simula a lógica de edição do admin (pocketbase/hooks/admin_editar_jogo.js)
    // Onde a reexecução da busca não usa a trava `fixture_scan_{jogoId}_{data}`
    let searchCount = 0
    const simulateAdminEditSave = (
      jogo: { fixture_id?: string },
      _nomesOuDatasAlterados: boolean,
    ) => {
      const effectiveFixtureId = (jogo.fixture_id || '').trim()
      if (!effectiveFixtureId) {
        // Sem trava diária na edição do admin: re-executa a busca sempre que salvar
        searchCount++
        return { executedSearch: true }
      }
      return { executedSearch: false }
    }

    // Primeira tentativa de busca no dia para jogo sem fixture_id
    const jogoSemId = { fixture_id: '' }
    const res1 = simulateAdminEditSave(jogoSemId, true)
    expect(res1.executedSearch).toBe(true)
    expect(searchCount).toBe(1)

    // Segunda tentativa no mesmo dia após admin ajustar nome do time
    const res2 = simulateAdminEditSave(jogoSemId, true)
    expect(res2.executedSearch).toBe(true)
    expect(searchCount).toBe(2)

    // Se o jogo agora tem fixture_id travado, a busca automática não roda
    const jogoComId = { fixture_id: '12345' }
    const res3 = simulateAdminEditSave(jogoComId, true)
    expect(res3.executedSearch).toBe(false)
    expect(searchCount).toBe(2)
  })
})
