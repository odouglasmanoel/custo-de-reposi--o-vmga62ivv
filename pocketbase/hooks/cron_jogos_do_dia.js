/**
 * pocketbase/hooks/cron_jogos_do_dia.js
 * ROTINA DESATIVADA POR SOLICITAÇÃO DO USUÁRIO.
 *
 * A aba 'Jogos do Dia' e a busca matinal geral de partidas da API-Football foram
 * desativadas para garantir uso EXCLUSIVO da API-Football nas escalações pré-jogo (~20 min antes).
 *
 * Nenhuma chamada externa à API-Football é efetuada por este módulo.
 */

// Endpoint mantido com resposta amigável de desativação (sem consumir cota e sem erro)
routerAdd('POST', '/backend/v1/jogos-do-dia/sincronizar-matinal', (e) => {
  return e.json(200, {
    success: false,
    desativado: true,
    notice:
      'A sincronização matinal geral de jogos foi desativada. A API-Football tem uso exclusivo para escalações das partidas do bolão.',
  })
})

routerAdd('GET', '/backend/v1/jogos-do-dia', (e) => {
  return e.json(200, {
    success: false,
    desativado: true,
    total: 0,
    fixtures: [],
    notice:
      'A aba Jogos do Dia foi desativada. A API-Football tem uso exclusivo para escalações das partidas do bolão.',
  })
})

// O cron cronAdd('jogos_do_dia_sync_matinal') foi completamente removido/desativado.
