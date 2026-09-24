// pocketbase/migrations/0069_corrigir_escudos_dinamarca.js
// Migration: Corrigir quaisquer registros de jogos ou enquetes que tenham associado
// a Dinamarca a escudos errados (como B.S.C. z3v04x1700688329.png),
// atualizando-os para o escudo oficial da API-Sports (teams/21.png).

migrate(
  (app) => {
    const OFFICIAL_DINAMARCA_LOGO = 'https://media.api-sports.io/football/teams/21.png'

    // 1. Corrigir na coleção jogos
    try {
      const jogosDinamarca = app.findRecordsByFilter(
        'jogos',
        "time_a ~ 'Dinamarca' || time_b ~ 'Dinamarca'",
      )

      for (let i = 0; i < jogosDinamarca.length; i++) {
        const j = jogosDinamarca[i]
        let changed = false
        const timeA = (j.getString('time_a') || '').trim()
        const timeB = (j.getString('time_b') || '').trim()
        const escudoA = (j.getString('url_escudo_mandante') || '').trim()
        const escudoB = (j.getString('url_escudo_visitante') || '').trim()

        if (timeA.toLowerCase().includes('dinamarca')) {
          if (!escudoA || escudoA.includes('z3v04x') || escudoA.includes('bsc')) {
            j.set('url_escudo_mandante', OFFICIAL_DINAMARCA_LOGO)
            changed = true
          }
        }

        if (timeB.toLowerCase().includes('dinamarca')) {
          if (!escudoB || escudoB.includes('z3v04x') || escudoB.includes('bsc')) {
            j.set('url_escudo_visitante', OFFICIAL_DINAMARCA_LOGO)
            changed = true
          }
        }

        if (changed) {
          app.save(j)
        }
      }
    } catch (errJogos) {
      console.log('[Migration 0069] Erro ao corrigir jogos da Dinamarca:', errJogos)
    }

    // 2. Corrigir na coleção enquete_jogos
    try {
      const enqueteJogos = app.findRecordsByFilter(
        'enquete_jogos',
        "time_a ~ 'Dinamarca' || time_b ~ 'Dinamarca'",
      )

      for (let i = 0; i < enqueteJogos.length; i++) {
        const ej = enqueteJogos[i]
        let changed = false
        const timeA = (ej.getString('time_a') || '').trim()
        const timeB = (ej.getString('time_b') || '').trim()
        const escudoA = (ej.getString('logo_casa') || '').trim()
        const escudoB = (ej.getString('logo_visitante') || '').trim()

        if (timeA.toLowerCase().includes('dinamarca')) {
          if (escudoA.includes('z3v04x') || escudoA.includes('bsc')) {
            ej.set('logo_casa', OFFICIAL_DINAMARCA_LOGO)
            changed = true
          }
        }

        if (timeB.toLowerCase().includes('dinamarca')) {
          if (escudoB.includes('z3v04x') || escudoB.includes('bsc')) {
            ej.set('logo_visitante', OFFICIAL_DINAMARCA_LOGO)
            changed = true
          }
        }

        if (changed) {
          app.save(ej)
        }
      }
    } catch (errEnquete) {
      console.log('[Migration 0069] Erro ao corrigir enquete_jogos da Dinamarca:', errEnquete)
    }
  },
  (app) => {
    // Rollback não aplicável
  },
)
