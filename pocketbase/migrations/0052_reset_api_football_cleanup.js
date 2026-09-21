/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  console.log(
    '[migration 0052] Iniciando Reset Completo e Limpeza Total das configurações de API...',
  )

  // 1. LEITURA E SALVAGUARDA CRÍTICA DA CHAVE DA API-FOOTBALL
  let savedApiKey = ''
  let sobrescritaJogosContent = ''

  try {
    const configRecords = app.findRecordsByFilter(
      'config_integracoes',
      "provedor = 'api_football'",
      'created',
      50,
      0,
    )
    for (let i = 0; i < configRecords.length; i++) {
      const rec = configRecords[i]
      const k = (rec.getString('api_key') || '').trim()
      const chave = rec.getString('chave') || ''

      if (chave === 'placar_ao_vivo' && k) {
        savedApiKey = k
      } else if (chave === 'sobrescrita_jogos' && k) {
        sobrescritaJogosContent = k
      } else if (!savedApiKey && k && !k.startsWith('{') && !k.startsWith('[')) {
        savedApiKey = k
      }
    }
  } catch (errRead) {
    console.log('[migration 0052] Aviso na leitura de salvaguarda de config_integracoes:', errRead)
  }

  // Fallback para secrets ou env se não encontrada no banco
  if (!savedApiKey) {
    try {
      if ($secrets && $secrets.has && $secrets.has('API_FOOTBALL_KEY')) {
        savedApiKey = ($secrets.get('API_FOOTBALL_KEY') || '').trim()
      } else if ($os && $os.getenv) {
        savedApiKey = ($os.getenv('API_FOOTBALL_KEY') || '').trim()
      }
    } catch (_) {}
  }

  console.log(
    '[migration 0052] Salvaguarda da chave API-Football:',
    savedApiKey
      ? 'Chave obtida (' + savedApiKey.slice(0, 4) + '...' + savedApiKey.slice(-4) + ')'
      : 'Chave não encontrada',
  )

  // 2. LIMPEZA TOTAL DA COLEÇÃO config_integracoes
  try {
    const allConfigs = app.findRecordsByFilter('config_integracoes', '', 'created', 500, 0)
    for (let i = 0; i < allConfigs.length; i++) {
      try {
        app.delete(allConfigs[i])
      } catch (errDel) {
        console.log(
          '[migration 0052] Erro ao deletar config_integracoes ' + allConfigs[i].id + ':',
          errDel,
        )
      }
    }
    console.log(
      '[migration 0052] Coleção config_integracoes limpa com sucesso. Registros deletados:',
      allConfigs.length,
    )
  } catch (errClearConfigs) {
    console.log('[migration 0052] Erro ao limpar config_integracoes:', errClearConfigs)
  }

  // 3. RE-CADASTRO LIMPO E ÚNICO DA CHAVE DA API-FOOTBALL
  try {
    const colConfig = app.findCollectionByNameOrId('config_integracoes')
    if (colConfig) {
      const novoPlacarAoVivo = new Record(colConfig)
      novoPlacarAoVivo.set('chave', 'placar_ao_vivo')
      novoPlacarAoVivo.set('provedor', 'api_football')
      novoPlacarAoVivo.set('api_key', savedApiKey)
      novoPlacarAoVivo.set('ativo', true)
      app.save(novoPlacarAoVivo)
      console.log(
        '[migration 0052] Registro único placar_ao_vivo recriado com a chave API-Football preservada.',
      )

      // Se havia sobrescrita manual de jogos do bolão cadastrada pelo admin Douglas, recria limpa
      if (sobrescritaJogosContent) {
        const novoSobrescrita = new Record(colConfig)
        novoSobrescrita.set('chave', 'sobrescrita_jogos')
        novoSobrescrita.set('provedor', 'api_football')
        novoSobrescrita.set('api_key', sobrescritaJogosContent)
        novoSobrescrita.set('ativo', true)
        app.save(novoSobrescrita)
        console.log('[migration 0052] Registro sobrescrita_jogos recriado com dados preservados.')
      }
    }
  } catch (errReinsert) {
    console.log('[migration 0052] Erro ao reinserir configuração limpa:', errReinsert)
  }

  // 4. LIMPEZA DE REGISTROS REMANESCENTES DE TheSportsDB E Football-Data.org
  // 4.1. Jogos com IDs herdados (tsdb_*) ou campos corrompidos/antigos
  try {
    const jogosTsdb = app.findRecordsByFilter('jogos', "fixture_id ~ 'tsdb'", 'created', 200, 0)
    for (let i = 0; i < jogosTsdb.length; i++) {
      try {
        const j = jogosTsdb[i]
        j.set('fixture_id', '') // Limpa fixture_id tsdb_* para que seja resolvido de forma limpa pela API-Football
        app.save(j)
      } catch (errJ) {
        console.log(
          '[migration 0052] Aviso ao limpar fixture_id do jogo ' + jogosTsdb[i].id + ':',
          errJ,
        )
      }
    }
    console.log('[migration 0052] Jogos com fixture_id tsdb_* higienizados:', jogosTsdb.length)
  } catch (errJogosTsdb) {
    console.log('[migration 0052] Aviso ao verificar jogos tsdb:', errJogosTsdb)
  }

  // 4.2. Escudos e referências remanescentes em jogos
  try {
    const jogosBadges = app.findRecordsByFilter(
      'jogos',
      "escudo_time_a ~ 'thesportsdb' || escudo_time_b ~ 'thesportsdb' || escudo_time_a ~ 'football-data' || escudo_time_b ~ 'football-data'",
      'created',
      200,
      0,
    )
    for (let i = 0; i < jogosBadges.length; i++) {
      try {
        const j = jogosBadges[i]
        const escA = j.getString('escudo_time_a') || ''
        const escB = j.getString('escudo_time_b') || ''
        let mudou = false
        if (escA.includes('thesportsdb') || escA.includes('football-data')) {
          j.set('escudo_time_a', '')
          mudou = true
        }
        if (escB.includes('thesportsdb') || escB.includes('football-data')) {
          j.set('escudo_time_b', '')
          mudou = true
        }
        if (mudou) app.save(j)
      } catch (errBadge) {
        console.log(
          '[migration 0052] Aviso ao limpar escudos residuais do jogo ' + jogosBadges[i].id + ':',
          errBadge,
        )
      }
    }
  } catch (errBadges) {
    console.log('[migration 0052] Aviso ao limpar escudos residuais:', errBadges)
  }

  // 4.3. Limpeza de registros residuais na coleção enquete_jogos
  try {
    const enqueteJogosObsoletos = app.findRecordsByFilter(
      'enquete_jogos',
      "origem_api = 'thesportsdb' || origem_api = 'football_data' || fixture_id ~ 'tsdb' || campeonato_logo ~ 'thesportsdb' || logo_casa ~ 'thesportsdb' || logo_visitante ~ 'thesportsdb' || campeonato_logo ~ 'football-data' || logo_casa ~ 'football-data' || logo_visitante ~ 'football-data'",
      'created',
      500,
      0,
    )
    for (let i = 0; i < enqueteJogosObsoletos.length; i++) {
      try {
        const ej = enqueteJogosObsoletos[i]
        // Se for jogo de enquete cuja origem era provedor desativado, apenas reseta a origem e escudos obsoletos
        if (
          ej.getString('origem_api') === 'thesportsdb' ||
          ej.getString('origem_api') === 'football_data'
        ) {
          ej.set('origem_api', 'api_football')
        }
        const fid = ej.getString('fixture_id') || ''
        if (fid.startsWith('tsdb_') || fid.startsWith('thesportsdb_')) {
          ej.set('fixture_id', '')
        }
        const cLogo = ej.getString('campeonato_logo') || ''
        if (cLogo.includes('thesportsdb') || cLogo.includes('football-data')) {
          ej.set('campeonato_logo', '')
        }
        const lCasa = ej.getString('logo_casa') || ''
        if (lCasa.includes('thesportsdb') || lCasa.includes('football-data')) {
          ej.set('logo_casa', '')
        }
        const lVis = ej.getString('logo_visitante') || ''
        if (lVis.includes('thesportsdb') || lVis.includes('football-data')) {
          ej.set('logo_visitante', '')
        }
        app.save(ej)
      } catch (errEj) {
        console.log(
          '[migration 0052] Aviso ao higienizar enquete_jogo ' + enqueteJogosObsoletos[i].id + ':',
          errEj,
        )
      }
    }
    console.log('[migration 0052] Enquete jogos higienizados:', enqueteJogosObsoletos.length)
  } catch (errEnquetesClean) {
    console.log('[migration 0052] Aviso ao limpar enquete_jogos residuais:', errEnquetesClean)
  }

  // 4.4. Limpeza de fichas técnicas antigas residuais gravadas em jogos
  try {
    const jogosFicha = app.findRecordsByFilter('jogos', "ficha_detalhes != ''", 'created', 200, 0)
    for (let i = 0; i < jogosFicha.length; i++) {
      try {
        const j = jogosFicha[i]
        const rawFicha = j.getString('ficha_detalhes') || ''
        if (
          rawFicha.includes('"provider":"thesportsdb"') ||
          rawFicha.includes('"provider":"football_data"')
        ) {
          // Limpa ficha técnica residual de provedor antigo
          j.set('ficha_detalhes', null)
          app.save(j)
        }
      } catch (_) {}
    }
  } catch (_) {}

  // 4.5. Limpa stores globais em memória se existirem
  try {
    if (typeof globalThis !== 'undefined') {
      globalThis.__placarAoVivoCacheStore = {}
      globalThis.__jogosDoDiaStore = {}
      globalThis.__apiFootballCircuitBreaker = {
        isBlocked: false,
        blockedUntil: 0,
        probing: false,
        reason: '',
      }
      globalThis.__apiFootballThrottle = { lastCallTimestamp: 0, minIntervalMs: 15 * 60 * 1000 }
      globalThis.__tsdbBadgeCache = {}
      globalThis.__tsdbLeagueCache = {}
      globalThis.__tsdbBackoffUntil = 0
    }
  } catch (_) {}

  console.log('[migration 0052] Reset Completo e Limpeza Total concluídos com sucesso!')
})
