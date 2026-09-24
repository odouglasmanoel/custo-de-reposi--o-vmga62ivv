migrate(
  (app) => {
    const adminCondition =
      "@request.auth.name = 'Douglas' || @request.auth.email = 'douglas@repress.com.br' || @request.auth.email = 'douglas.manoel@repress.com.br'"

    // 1. Atualizar regras da coleção 'jogos'
    try {
      const jogos = app.findCollectionByNameOrId('jogos')
      jogos.listRule = "@request.auth.id != ''"
      jogos.viewRule = "@request.auth.id != ''"
      jogos.createRule = adminCondition
      jogos.updateRule = adminCondition
      jogos.deleteRule = adminCondition
      app.save(jogos)
    } catch (errJogos) {
      console.log('[migration 0068] Aviso ao atualizar regras de jogos:', errJogos)
    }

    // 2. Atualizar regras da coleção 'users' para manter Douglas com permissão total mesmo se nome mudar
    try {
      const users = app.findCollectionByNameOrId('users')
      users.listRule = 'id = @request.auth.id || ' + adminCondition
      users.viewRule = 'id = @request.auth.id || ' + adminCondition
      users.updateRule = 'id = @request.auth.id || ' + adminCondition
      users.deleteRule = adminCondition
      app.save(users)
    } catch (errUsers) {
      console.log('[migration 0068] Aviso ao atualizar regras de users:', errUsers)
    }

    // 3. Atualizar regras de 'config_integracoes' para permitir que o admin autenticado acerte fallback de sobrescrita se necessário
    try {
      const configCol = app.findCollectionByNameOrId('config_integracoes')
      configCol.listRule = adminCondition
      configCol.viewRule = adminCondition
      configCol.createRule = adminCondition
      configCol.updateRule = adminCondition
      app.save(configCol)
    } catch (errConfig) {
      console.log('[migration 0068] Aviso ao atualizar regras de config_integracoes:', errConfig)
    }
  },
  (app) => {
    try {
      const jogos = app.findCollectionByNameOrId('jogos')
      jogos.createRule = "@request.auth.name = 'Douglas'"
      jogos.updateRule = "@request.auth.name = 'Douglas'"
      jogos.deleteRule = "@request.auth.name = 'Douglas'"
      app.save(jogos)
    } catch (_) {}
  },
)
