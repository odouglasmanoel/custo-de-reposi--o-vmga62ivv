migrate(
  (app) => {
    // Garantir que todos os campos da tabela 'jogos' tenham configurações adequadas
    // e preencher defaults em registros que contenham valores nulos para evitar
    // falhas em validações ou índices.
    try {
      const jogosCol = app.findCollectionByNameOrId('jogos')

      // Verificar fixture_id
      if (!jogosCol.fields.getByName('fixture_id')) {
        jogosCol.fields.add(
          new TextField({
            name: 'fixture_id',
            required: false,
          }),
        )
      }

      // Verificar competicao
      if (!jogosCol.fields.getByName('competicao')) {
        jogosCol.fields.add(
          new TextField({
            name: 'competicao',
            required: false,
          }),
        )
      }

      // Garantir que campos booleanos e texto não sejam bloqueantes
      const resFin = jogosCol.fields.getByName('resultado_finalizado')
      if (resFin && resFin.required) {
        resFin.required = false
      }

      const temPen = jogosCol.fields.getByName('tem_penaltis')
      if (temPen && temPen.required) {
        temPen.required = false
      }

      const vencPen = jogosCol.fields.getByName('vencedor_penaltis')
      if (vencPen && vencPen.required) {
        vencPen.required = false
      }

      const placarA = jogosCol.fields.getByName('placar_a')
      if (placarA && placarA.required) {
        placarA.required = false
      }

      const placarB = jogosCol.fields.getByName('placar_b')
      if (placarB && placarB.required) {
        placarB.required = false
      }

      const golsA = jogosCol.fields.getByName('gols_time_a')
      if (golsA && golsA.required) {
        golsA.required = false
      }

      const golsB = jogosCol.fields.getByName('gols_time_b')
      if (golsB && golsB.required) {
        golsB.required = false
      }

      app.save(jogosCol)

      // Garantir coerência nos dados existentes via SQL nativo
      app
        .db()
        .newQuery(`
        UPDATE jogos SET
          resultado_finalizado = COALESCE(resultado_finalizado, 0),
          tem_penaltis = COALESCE(tem_penaltis, 0),
          competicao = COALESCE(competicao, ''),
          fixture_id = COALESCE(fixture_id, ''),
          vencedor_penaltis = COALESCE(vencedor_penaltis, ''),
          gols_time_a = CASE WHEN gols_time_a IS NULL OR gols_time_a = '' THEN '[]' ELSE gols_time_a END,
          gols_time_b = CASE WHEN gols_time_b IS NULL OR gols_time_b = '' THEN '[]' ELSE gols_time_b END
        WHERE resultado_finalizado IS NULL OR tem_penaltis IS NULL OR competicao IS NULL OR fixture_id IS NULL;
      `)
        .execute()
    } catch (err) {
      console.log('[0042_ensure_jogos_schema_defaults] Aviso:', err)
    }
  },
  (app) => {},
)
