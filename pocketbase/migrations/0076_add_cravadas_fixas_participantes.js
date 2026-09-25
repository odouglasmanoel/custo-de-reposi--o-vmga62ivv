migrate(
  (app) => {
    // Migration 0076: Adicionar campo cravadas_fixas na collection participantes
    // e gravar os totais consolidados oficiais de cravadas por copa do Douglas:
    // - Copa do Mundo (hy6ade9obylh404): 8 cravadas
    // - Copa Coni (kr20rfjisajd6ro): 6 cravadas
    // - Copa Sormani (xdtvijyapxuw99y): 2 cravadas
    // - Copa Genilton (qdpy2honwivb5zw): 3 cravadas
    // Total Geral: 8 + 6 + 2 + 3 = 19 cravadas.
    // PONTUAÇÕES TOTAIS E PONTOS IMPORTADOS FICAM 100% INTACTOS E CONGELADOS.
    try {
      const col = app.findCollectionByNameOrId('participantes')

      if (!col.fields.getByName('cravadas_fixas')) {
        col.fields.add(
          new NumberField({
            name: 'cravadas_fixas',
            onlyInt: true,
          }),
        )
        app.save(col)
        console.log(
          '[migration 0076] Campo cravadas_fixas adicionado com sucesso na collection participantes.',
        )
      }

      // Douglas por copa com números oficiais
      const douglasCravadasPorCopa = [
        {
          id: 'i6kaaw12v3l9adh',
          nome: 'Douglas',
          bolao: 'hy6ade9obylh404', // Copa do Mundo
          cravadas_fixas: 8,
        },
        {
          id: 'ab3sjd3vctc8l0n',
          nome: 'Douglas',
          bolao: 'kr20rfjisajd6ro', // Copa Coni
          cravadas_fixas: 6,
        },
        {
          id: '4vfl6xcy0jj51d4',
          nome: 'Douglas',
          bolao: 'xdtvijyapxuw99y', // Copa Sormani
          cravadas_fixas: 2,
        },
        {
          id: 'v7idfj7z96dle4k',
          nome: 'Douglas',
          bolao: 'qdpy2honwivb5zw', // Copa Genilton
          cravadas_fixas: 3,
        },
      ]

      for (let i = 0; i < douglasCravadasPorCopa.length; i++) {
        const item = douglasCravadasPorCopa[i]
        let rec = null
        try {
          rec = app.findRecordById('participantes', item.id)
        } catch (_) {
          try {
            const matches = app.findRecordsByFilter(
              'participantes',
              "bolao = '" + item.bolao + "' && nome = '" + item.nome + "'",
              '',
              1,
              0,
            )
            if (matches.length > 0) rec = matches[0]
          } catch (_) {}
        }

        if (rec) {
          rec.set('cravadas_fixas', item.cravadas_fixas)
          app.save(rec)
          console.log(
            '[migration 0076] Cravadas fixas atualizadas para ' +
              item.nome +
              ' no bolão ' +
              item.bolao +
              ': ' +
              item.cravadas_fixas,
          )
        }
      }

      console.log('[migration 0076] Concluído com sucesso.')
    } catch (err) {
      console.log('[migration 0076] Erro ao aplicar migração:', err)
      throw err
    }
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('participantes')
      if (col.fields.getByName('cravadas_fixas')) {
        col.fields.removeByName('cravadas_fixas')
        app.save(col)
      }
    } catch (_) {}
  },
)
