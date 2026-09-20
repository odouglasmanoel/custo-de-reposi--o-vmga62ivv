/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  // 1. Atualizar registro do jogo Corinthians x Fluminense (id: pfliz8m05oqef6s)
  try {
    const jogo = app.findRecordById('jogos', 'pfliz8m05oqef6s')
    if (jogo) {
      // Fixture ID real da partida na API-Football
      jogo.set('fixture_id', '1492382')
      jogo.set('placar_a', 0)
      jogo.set('placar_b', 1)

      // Gols Time A (Corinthians): 0 gols
      jogo.set('gols_time_a', [])
      jogo.set('goleadores_a', [])

      // Gols Time B (Fluminense): Hulk aos 42'
      const scorersB = [
        {
          nome: 'Hulk',
          minuto: '42',
          posicao: 'Atacante',
          quantidade: 1,
        },
      ]
      jogo.set('gols_time_b', scorersB)
      jogo.set('goleadores_b', scorersB)

      app.save(jogo)
      console.log(
        '[migration 0049] Jogo Corinthians x Fluminense (pfliz8m05oqef6s) atualizado com sucesso com fixture_id 1492382 e gol de Hulk.',
      )
    }
  } catch (errJogo) {
    console.log('[migration 0049] Aviso ao atualizar jogo pfliz8m05oqef6s:', errJogo)
  }

  // 2. Limpar caches obsoletos em config_integracoes (cache_api_football_fixtures_*, cache_jogos_do_dia_*)
  try {
    const configs = app.findAllRecords('config_integracoes')
    for (let i = 0; i < configs.length; i++) {
      const rec = configs[i]
      const chave = rec.getString('chave') || ''
      if (
        chave.indexOf('cache_api_football_fixtures_') === 0 ||
        chave.indexOf('cache_jogos_do_dia_') === 0 ||
        chave === 'cache_sobrescrita_jogos'
      ) {
        try {
          app.delete(rec)
          console.log('[migration 0049] Cache obsoleto deletado de config_integracoes: ' + chave)
        } catch (delErr) {
          console.log('[migration 0049] Erro ao deletar chave ' + chave + ':', delErr)
        }
      }
    }
  } catch (errConfig) {
    console.log('[migration 0049] Aviso ao limpar caches em config_integracoes:', errConfig)
  }
})
