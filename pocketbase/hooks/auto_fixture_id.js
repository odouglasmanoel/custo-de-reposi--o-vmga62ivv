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
            `[auto_fixture_id enquete_jogos] fixture_id ${foundId} atribuído automaticamente a ${timeA} x ${timeB}`,
          )
        }
      }
    }
  } catch (err) {
    console.log('[auto_fixture_id enquete_jogos] Aviso não-bloqueante:', err)
  }

  e.next()
}, 'enquete_jogos')
