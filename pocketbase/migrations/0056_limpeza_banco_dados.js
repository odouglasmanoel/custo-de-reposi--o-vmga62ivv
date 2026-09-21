/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  console.log('[migration 0056] Iniciando limpeza de dados residuais e duplicados...')

  // 1. Limpeza de registros em duplicidade em enquete_jogos
  // Identifica pares duplicados por (enquete, data, time_a, time_b) mantendo o registro mais antigo
  try {
    const todosEnqueteJogos = app.findRecordsByFilter('enquete_jogos', '', 'created', 1000, 0)
    const vistos = {}
    let deletadosDuplicados = 0

    for (let i = 0; i < todosEnqueteJogos.length; i++) {
      const ej = todosEnqueteJogos[i]
      const enqId = ej.getString('enquete') || ''
      const dt = ej.getString('data') || ''
      const tA = (ej.getString('time_a') || '').trim().toLowerCase()
      const tB = (ej.getString('time_b') || '').trim().toLowerCase()
      const pairKey = enqId + '::' + dt + '::' + [tA, tB].sort().join('__')

      if (vistos[pairKey]) {
        // Verifica se o duplicado possui votos antes de deletar
        const votosCount = app.countRecords('enquete_votos', "jogo = '" + ej.id + "'")
        if (votosCount === 0) {
          app.delete(ej)
          deletadosDuplicados++
        }
      } else {
        vistos[pairKey] = ej.id
      }
    }
    console.log(
      '[migration 0056] Enquete jogos duplicados sem votos removidos:',
      deletadosDuplicados,
    )
  } catch (errDup) {
    console.log('[migration 0056] Aviso ao limpar duplicatas de enquete_jogos:', errDup)
  }

  // 2. Limpeza de fixture_id tsdb_* residuais em enquete_jogos (substituindo por vazio para resolução limpa)
  try {
    const tsdbEnqueteJogos = app.findRecordsByFilter(
      'enquete_jogos',
      "fixture_id ~ 'tsdb'",
      'created',
      200,
      0,
    )
    for (let i = 0; i < tsdbEnqueteJogos.length; i++) {
      try {
        const ej = tsdbEnqueteJogos[i]
        ej.set('fixture_id', '')
        app.save(ej)
      } catch (_) {}
    }
    console.log(
      '[migration 0056] fixture_id tsdb_* higienizados em enquete_jogos:',
      tsdbEnqueteJogos.length,
    )
  } catch (errEjTsdb) {
    console.log('[migration 0056] Aviso ao higienizar fixture_id tsdb em enquete_jogos:', errEjTsdb)
  }

  // 3. Limpeza de URLs antigas corrompidas de badges/escudos em enquete_jogos (remanescentes que falharam no carregamento)
  try {
    const invalidBadges = app.findRecordsByFilter(
      'enquete_jogos',
      "logo_casa ~ 'placeholder' || logo_visitante ~ 'placeholder'",
      'created',
      200,
      0,
    )
    for (let i = 0; i < invalidBadges.length; i++) {
      try {
        const ej = invalidBadges[i]
        let mudou = false
        if ((ej.getString('logo_casa') || '').includes('placeholder')) {
          ej.set('logo_casa', '')
          mudou = true
        }
        if ((ej.getString('logo_visitante') || '').includes('placeholder')) {
          ej.set('logo_visitante', '')
          mudou = true
        }
        if (mudou) app.save(ej)
      } catch (_) {}
    }
  } catch (_) {}

  // 4. Limpeza de stores globais em memória
  try {
    if (typeof globalThis !== 'undefined') {
      globalThis.__placarAoVivoCacheStore = {}
      globalThis.__jogosDoDiaStore = {}
      globalThis.__jogosDoDiaDbCache = null
      globalThis.__tsdbBadgeCache = {}
      globalThis.__tsdbLeagueCache = {}
    }
  } catch (_) {}

  console.log('[migration 0056] Limpeza concluída com sucesso.')
})
