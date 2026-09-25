// pocketbase/migrations/0071_corrigir_escudos_selecoes_nacionais.js
// Migration: Higienizar e corrigir escudos e bandeiras de seleções nacionais
// nas coleções 'jogos' e 'enquete_jogos'. Substitui escudos contaminados de clubes
// (como 192.png do Köln para Turquia/Bélgica, clubes verdes, ou links TheSportsDB)
// pela bandeira oficial FlagCDN ou pelo logo oficial verificado da seleção na API-Sports.

migrate(
  (app) => {
    // Mapa com bandeiras / escudos oficiais garantidos
    const SELECOES_OFICIAIS = {
      turquia: 'https://flagcdn.com/w80/tr.png',
      belgica: 'https://flagcdn.com/w80/be.png',
      franca: 'https://flagcdn.com/w80/fr.png',
      georgia: 'https://flagcdn.com/w80/ge.png',
      jamaica: 'https://flagcdn.com/w80/jm.png',
      honduras: 'https://flagcdn.com/w80/hn.png',
      elsalvador: 'https://flagcdn.com/w80/sv.png',
      martinica: 'https://flagcdn.com/w80/mq.png',
      montserrat: 'https://flagcdn.com/w80/ms.png',
      tchequia: 'https://flagcdn.com/w80/cz.png',
      croacia: 'https://flagcdn.com/w80/hr.png',
      italia: 'https://flagcdn.com/w80/it.png',
      portugal: 'https://flagcdn.com/w80/pt.png',
      dinamarca: 'https://media.api-sports.io/football/teams/21.png',
      noruega: 'https://media.api-sports.io/football/teams/1090.png',
      inglaterra: 'https://flagcdn.com/w80/gb-eng.png',
      espanha: 'https://flagcdn.com/w80/es.png',
      escocia: 'https://flagcdn.com/w80/gb-sct.png',
      paisdegales: 'https://media.api-sports.io/football/teams/767.png',
      japao: 'https://flagcdn.com/w80/jp.png',
      uruguai: 'https://media.api-sports.io/football/teams/7.png',
      brasil: 'https://media.api-sports.io/football/teams/6.png',
      argentina: 'https://media.api-sports.io/football/teams/26.png',
      alemanha: 'https://media.api-sports.io/football/teams/25.png',
      holanda: 'https://media.api-sports.io/football/teams/1118.png',
      estadosunidos: 'https://flagcdn.com/w80/us.png',
      mexico: 'https://flagcdn.com/w80/mx.png',
      colombia: 'https://flagcdn.com/w80/co.png',
      chile: 'https://flagcdn.com/w80/cl.png',
      paraguai: 'https://flagcdn.com/w80/py.png',
      venezuela: 'https://flagcdn.com/w80/ve.png',
      bolivia: 'https://flagcdn.com/w80/bo.png',
      marrocos: 'https://flagcdn.com/w80/ma.png',
      senegal: 'https://flagcdn.com/w80/sn.png',
      suica: 'https://flagcdn.com/w80/ch.png',
      suecia: 'https://flagcdn.com/w80/se.png',
      polonia: 'https://flagcdn.com/w80/pl.png',
      servia: 'https://flagcdn.com/w80/rs.png',
      ucrania: 'https://flagcdn.com/w80/ua.png',
      austria: 'https://flagcdn.com/w80/at.png',
      hungria: 'https://flagcdn.com/w80/hu.png',
      irlandadonorte: 'https://flagcdn.com/w80/gb-nir.png',
    }

    function normalizar(nome) {
      if (!nome) return ''
      let s = String(nome).toLowerCase()
      // Remove acentos
      s = s
        .replace(/[áàâãä]/g, 'a')
        .replace(/[éèêë]/g, 'e')
        .replace(/[íìîï]/g, 'i')
        .replace(/[óòôõö]/g, 'o')
        .replace(/[úùûü]/g, 'u')
        .replace(/ç/g, 'c')
      s = s.replace(/[^a-z0-9]/g, '')
      return s
    }

    function isContaminado(url) {
      if (!url) return false
      const lower = url.toLowerCase()
      if (lower.includes('thesportsdb.com')) return true
      if (
        lower.includes('/192.') ||
        lower.includes('/192_') ||
        lower.includes('koln') ||
        lower.includes('cologne')
      )
        return true
      if (lower.includes('z3v04x') || lower.includes('bsc')) return true
      return false
    }

    // 1. Atualizar e higienizar na coleção 'jogos'
    try {
      const todosJogos = app.findRecordsByFilter('jogos', '1=1', 'created', 2000, 0)
      for (let i = 0; i < todosJogos.length; i++) {
        const j = todosJogos[i]
        let changed = false
        const timeA = j.getString('time_a') || ''
        const timeB = j.getString('time_b') || ''
        const normA = normalizar(timeA)
        const normB = normalizar(timeB)
        const escudoA = j.getString('url_escudo_mandante') || ''
        const escudoB = j.getString('url_escudo_visitante') || ''

        if (SELECOES_OFICIAIS[normA]) {
          // Se estava vazio, com TheSportsDB ou contaminado por clube (192, koln, etc)
          if (!escudoA || isContaminado(escudoA)) {
            j.set('url_escudo_mandante', SELECOES_OFICIAIS[normA])
            changed = true
          }
        }

        if (SELECOES_OFICIAIS[normB]) {
          if (!escudoB || isContaminado(escudoB)) {
            j.set('url_escudo_visitante', SELECOES_OFICIAIS[normB])
            changed = true
          }
        }

        if (changed) {
          app.save(j)
        }
      }
    } catch (errJogos) {
      console.log('[Migration 0071] Aviso jogos:', errJogos)
    }

    // 2. Atualizar e higienizar na coleção 'enquete_jogos'
    try {
      const todosEnqueteJogos = app.findRecordsByFilter('enquete_jogos', '1=1', 'created', 2000, 0)
      for (let i = 0; i < todosEnqueteJogos.length; i++) {
        const ej = todosEnqueteJogos[i]
        let changed = false
        const timeA = ej.getString('time_a') || ''
        const timeB = ej.getString('time_b') || ''
        const normA = normalizar(timeA)
        const normB = normalizar(timeB)
        const logoCasa = ej.getString('logo_casa') || ''
        const logoVis = ej.getString('logo_visitante') || ''

        if (SELECOES_OFICIAIS[normA]) {
          if (!logoCasa || isContaminado(logoCasa)) {
            ej.set('logo_casa', SELECOES_OFICIAIS[normA])
            changed = true
          }
        }

        if (SELECOES_OFICIAIS[normB]) {
          if (!logoVis || isContaminado(logoVis)) {
            ej.set('logo_visitante', SELECOES_OFICIAIS[normB])
            changed = true
          }
        }

        if (changed) {
          app.save(ej)
        }
      }
    } catch (errEnquetes) {
      console.log('[Migration 0071] Aviso enquete_jogos:', errEnquetes)
    }
  },
  (app) => {
    // Rollback não aplicável
  },
)
