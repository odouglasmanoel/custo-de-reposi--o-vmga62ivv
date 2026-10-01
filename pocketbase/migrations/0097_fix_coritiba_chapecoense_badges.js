/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    console.log(
      '[migration 0097] Iniciando correção de escudos Coritiba (132) x Chapecoense (147)...',
    )

    const CORITIBA_URL = 'https://media.api-sports.io/football/teams/132.png'
    const CHAPE_URL = 'https://media.api-sports.io/football/teams/147.png'

    function isCoritiba(name) {
      if (!name) return false
      const n = name.trim().toLowerCase()
      return n === 'coritiba' || n === 'cfc' || n === 'coxa' || n.indexOf('coritiba') >= 0
    }

    function isChapecoense(name) {
      if (!name) return false
      const n = name.trim().toLowerCase()
      return n === 'chapecoense' || n === 'chape' || n === 'acf' || n.indexOf('chapecoense') >= 0
    }

    function fixFichaDetalhes(rawFicha) {
      if (!rawFicha) return rawFicha
      try {
        let fichaStr = typeof rawFicha === 'string' ? rawFicha : JSON.stringify(rawFicha)
        let changed = false

        // Se contiver objeto parsed ou texto
        // Substituir inversões comuns se existirem
        // Retornamos objeto se foi objeto, string se foi string
        const obj = typeof rawFicha === 'object' ? rawFicha : JSON.parse(fichaStr)
        if (obj) {
          if (obj.time_casa || obj.homeTeam) {
            const hName = obj.time_casa || (obj.homeTeam && obj.homeTeam.name) || ''
            if (
              isCoritiba(hName) &&
              (obj.logo_casa === CHAPE_URL || (obj.homeTeam && obj.homeTeam.logo === CHAPE_URL))
            ) {
              if (obj.logo_casa) obj.logo_casa = CORITIBA_URL
              if (obj.homeTeam && obj.homeTeam.logo) obj.homeTeam.logo = CORITIBA_URL
              changed = true
            } else if (
              isChapecoense(hName) &&
              (obj.logo_casa === CORITIBA_URL ||
                (obj.homeTeam && obj.homeTeam.logo === CORITIBA_URL))
            ) {
              if (obj.logo_casa) obj.logo_casa = CHAPE_URL
              if (obj.homeTeam && obj.homeTeam.logo) obj.homeTeam.logo = CHAPE_URL
              changed = true
            }
          }
          if (obj.time_visitante || obj.awayTeam) {
            const aName = obj.time_visitante || (obj.awayTeam && obj.awayTeam.name) || ''
            if (
              isCoritiba(aName) &&
              (obj.logo_visitante === CHAPE_URL ||
                (obj.awayTeam && obj.awayTeam.logo === CHAPE_URL))
            ) {
              if (obj.logo_visitante) obj.logo_visitante = CORITIBA_URL
              if (obj.awayTeam && obj.awayTeam.logo) obj.awayTeam.logo = CORITIBA_URL
              changed = true
            } else if (
              isChapecoense(aName) &&
              (obj.logo_visitante === CORITIBA_URL ||
                (obj.awayTeam && obj.awayTeam.logo === CORITIBA_URL))
            ) {
              if (obj.logo_visitante) obj.logo_visitante = CHAPE_URL
              if (obj.awayTeam && obj.awayTeam.logo) obj.awayTeam.logo = CHAPE_URL
              changed = true
            }
          }
        }
        return changed ? obj : null
      } catch (_) {
        return null
      }
    }

    // 1. Atualizar enquete_jogos
    try {
      const enqueteJogos = app.findRecordsByFilter(
        'enquete_jogos',
        "time_a ~ 'Coritiba' || time_b ~ 'Coritiba' || time_a ~ 'Chapecoense' || time_b ~ 'Chapecoense' || logo_casa ~ '132' || logo_visitante ~ '132' || logo_casa ~ '147' || logo_visitante ~ '147'",
        '',
        500,
        0,
      )

      console.log('[migration 0097] Registros enquete_jogos encontrados: ' + enqueteJogos.length)

      for (let i = 0; i < enqueteJogos.length; i++) {
        const ej = enqueteJogos[i]
        const timeA = ej.getString('time_a') || ''
        const timeB = ej.getString('time_b') || ''
        let altered = false

        if (isCoritiba(timeA)) {
          ej.set('logo_casa', CORITIBA_URL)
          altered = true
        } else if (isChapecoense(timeA)) {
          ej.set('logo_casa', CHAPE_URL)
          altered = true
        }

        if (isCoritiba(timeB)) {
          ej.set('logo_visitante', CORITIBA_URL)
          altered = true
        } else if (isChapecoense(timeB)) {
          ej.set('logo_visitante', CHAPE_URL)
          altered = true
        }

        if (altered) {
          app.save(ej)
          console.log(
            '[migration 0097] enquete_jogos ID ' +
              ej.id +
              ' corrigido (' +
              timeA +
              ' x ' +
              timeB +
              ')',
          )
        }
      }
    } catch (errEj) {
      console.log('[migration 0097] Erro ao corrigir enquete_jogos:', errEj)
    }

    // 2. Atualizar jogos
    try {
      const jogos = app.findRecordsByFilter(
        'jogos',
        "time_a ~ 'Coritiba' || time_b ~ 'Coritiba' || time_a ~ 'Chapecoense' || time_b ~ 'Chapecoense' || url_escudo_mandante ~ '132' || url_escudo_visitante ~ '132' || url_escudo_mandante ~ '147' || url_escudo_visitante ~ '147'",
        '',
        500,
        0,
      )

      console.log('[migration 0097] Registros jogos encontrados: ' + jogos.length)

      for (let j = 0; j < jogos.length; j++) {
        const jg = jogos[j]
        const timeA = jg.getString('time_a') || ''
        const timeB = jg.getString('time_b') || ''
        let altered = false

        if (isCoritiba(timeA)) {
          jg.set('url_escudo_mandante', CORITIBA_URL)
          altered = true
        } else if (isChapecoense(timeA)) {
          jg.set('url_escudo_mandante', CHAPE_URL)
          altered = true
        }

        if (isCoritiba(timeB)) {
          jg.set('url_escudo_visitante', CORITIBA_URL)
          altered = true
        } else if (isChapecoense(timeB)) {
          jg.set('url_escudo_visitante', CHAPE_URL)
          altered = true
        }

        // Ficha detalhes
        try {
          const rawFicha = jg.get('ficha_detalhes')
          const updatedFicha = fixFichaDetalhes(rawFicha)
          if (updatedFicha) {
            jg.set('ficha_detalhes', updatedFicha)
            altered = true
          }
        } catch (_) {}

        if (altered) {
          app.save(jg)
          console.log(
            '[migration 0097] jogos ID ' + jg.id + ' corrigido (' + timeA + ' x ' + timeB + ')',
          )
        }
      }
    } catch (errJg) {
      console.log('[migration 0097] Erro ao corrigir jogos:', errJg)
    }

    console.log('[migration 0097] Migração de escudos concluída!')
  },
  (app) => {},
)
