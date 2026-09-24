// pocketbase/hooks/auto_fixture_id.js
// Hook executado antes ou durante a criação de registros em 'jogos' e 'enquete_jogos'.
// Se fixture_id vier vazio, tenta buscar automaticamente pelo cruzamento de data + nomes dos times.
// Em caso de falha ou cota esgotada, persiste o jogo normalmente com fixture_id vazio, SEM erro para o usuário.

onRecordCreate((e) => {
  const rec = e.record
  try {
    const curFixtureId = (rec.getString('fixture_id') || '').trim()
    if (!curFixtureId) {
      const timeA = (rec.getString('time_a') || '').trim()
      const timeB = (rec.getString('time_b') || '').trim()
      const dataVal = (rec.getString('data') || '').trim()

      if (timeA && timeB && dataVal) {
        const { buscarFixtureIdNaApi } = require(`${__hooks}/fixtures_matcher.js`)
        const foundId = buscarFixtureIdNaApi(timeA, timeB, dataVal)
        if (foundId) {
          rec.set('fixture_id', foundId)
          console.log(
            `[auto_fixture_id jogos] fixture_id ${foundId} atribuído automaticamente a ${timeA} x ${timeB}`,
          )
        }
      }
    }
  } catch (err) {
    console.log('[auto_fixture_id jogos] Aviso não-bloqueante:', err)
  }

  e.next()
}, 'jogos')

onRecordCreate((e) => {
  const rec = e.record
  try {
    const curFixtureId = (rec.getString('fixture_id') || '').trim()
    const logoMandanteAtual = (rec.getString('logo_casa') || '').trim()
    const logoVisitanteAtual = (rec.getString('logo_visitante') || '').trim()

    const timeA = (rec.getString('time_a') || '').trim()
    const timeB = (rec.getString('time_b') || '').trim()
    const dataVal = (rec.getString('data') || '').trim()

    const { buscarFixtureDetalhadaNaApi } = require(`${__hooks}/fixtures_matcher.js`)

    // 1. Se NÃO tem fixture_id, busca por confronto (/fixtures com data + times)
    if (!curFixtureId && timeA && timeB && dataVal) {
      const matchRes = buscarFixtureDetalhadaNaApi(timeA, timeB, dataVal)
      if (matchRes && matchRes.fixture_id) {
        rec.set('fixture_id', matchRes.fixture_id)
        // Substitui escudos pelos oficiais retornados pela API (substituindo TheSportsDB)
        if (matchRes.logo_mandante) {
          rec.set('logo_casa', matchRes.logo_mandante)
        }
        if (matchRes.logo_visitante) {
          rec.set('logo_visitante', matchRes.logo_visitante)
        }
        console.log(
          `[auto_fixture_id enquete_jogos] fixture_id ${matchRes.fixture_id} e escudos oficiais atribuídos automaticamente a ${timeA} x ${timeB}`,
        )
      }
    }
  } catch (err) {
    console.log('[auto_fixture_id enquete_jogos] Aviso não-bloqueante:', err)
  }

  e.next()
}, 'enquete_jogos')

onRecordUpdate((e) => {
  const rec = e.record
  try {
    const curFixtureId = (rec.getString('fixture_id') || '').trim()
    const timeA = (rec.getString('time_a') || '').trim()
    const timeB = (rec.getString('time_b') || '').trim()
    const dataVal = (rec.getString('data') || '').trim()

    // Se NÃO tem fixture_id salvo mesmo após update, tenta busca automática
    if (!curFixtureId && timeA && timeB && dataVal) {
      const { buscarFixtureDetalhadaNaApi } = require(`${__hooks}/fixtures_matcher.js`)
      const matchRes = buscarFixtureDetalhadaNaApi(timeA, timeB, dataVal)
      if (matchRes && matchRes.fixture_id) {
        rec.set('fixture_id', matchRes.fixture_id)
        if (matchRes.logo_mandante) {
          rec.set('logo_casa', matchRes.logo_mandante)
        }
        if (matchRes.logo_visitante) {
          rec.set('logo_visitante', matchRes.logo_visitante)
        }
        console.log(
          `[auto_fixture_id enquete_jogos:update] fixture_id ${matchRes.fixture_id} e escudos atribuídos a ${timeA} x ${timeB}`,
        )
      }
    }
  } catch (err) {
    console.log('[auto_fixture_id enquete_jogos:update] Aviso não-bloqueante:', err)
  }

  e.next()
}, 'enquete_jogos')
