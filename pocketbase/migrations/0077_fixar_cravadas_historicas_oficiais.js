migrate(
  (app) => {
    // Migration 0077: Fixar valores de cravadas históricas importadas no banco
    // Validação obrigatória:
    // Douglas possui valores oficiais por copa:
    // - 8 na Copa do Mundo (hy6ade9obylh404)
    // - 6 na Copa Coni (kr20rfjisajd6ro)
    // - 2 na Copa Sormani (xdtvijyapxuw99y)
    // - 3 na Copa Genilton (qdpy2honwivb5zw)
    // Total Geral = 19 cravadas.
    // Todos os demais participantes e registros têm cravadas_fixas garantidas e idempotentes.
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
        console.log('[migration 0077] Campo cravadas_fixas garantido na collection participantes.')
      }

      // Configuração oficial de cravadas fixas importadas por participante e por copa
      const cravadasOficiais = [
        // Douglas: 8 Mundo, 6 Coni, 2 Sormani, 3 Genilton = 19 Geral
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

        // Davi
        {
          id: 'kvgc6c0fwhl0l9p',
          nome: 'Davi',
          bolao: 'hy6ade9obylh404',
          cravadas_fixas: 0,
        },
        {
          id: 'umcv669v5mdfe0r',
          nome: 'Davi',
          bolao: 'kr20rfjisajd6ro',
          cravadas_fixas: 0,
        },
        {
          id: '4b44sdmnk0b8mdn',
          nome: 'Davi',
          bolao: 'xdtvijyapxuw99y',
          cravadas_fixas: 0,
        },
        {
          id: '0izs3aqh2jsc9hl',
          nome: 'Davi',
          bolao: 'qdpy2honwivb5zw',
          cravadas_fixas: 0,
        },

        // Gabriel
        {
          id: 'trome8p25i4b75p',
          nome: 'Gabriel',
          bolao: 'hy6ade9obylh404',
          cravadas_fixas: 0,
        },
        {
          id: '09yarueqvzdkca0',
          nome: 'Gabriel',
          bolao: 'kr20rfjisajd6ro',
          cravadas_fixas: 0,
        },
        {
          id: '9wnn50qbtu0zd0g',
          nome: 'Gabriel',
          bolao: 'xdtvijyapxuw99y',
          cravadas_fixas: 0,
        },
        {
          id: 'gkecxx8je2gf0d5',
          nome: 'Gabriel',
          bolao: 'qdpy2honwivb5zw',
          cravadas_fixas: 0,
        },

        // Bruno Lopes
        {
          id: 'dqqt8gucvr0jwgg',
          nome: 'Bruno Lopes',
          bolao: 'hy6ade9obylh404',
          cravadas_fixas: 0,
        },
        {
          id: 'c1a3v87mi2v8iiy',
          nome: 'Bruno Lopes',
          bolao: 'kr20rfjisajd6ro',
          cravadas_fixas: 0,
        },
        {
          id: 'k2km4ejz4rfz992',
          nome: 'Bruno Lopes',
          bolao: 'xdtvijyapxuw99y',
          cravadas_fixas: 0,
        },
        {
          id: 'z06yes6lfpqajwp',
          nome: 'Bruno Lopes',
          bolao: 'qdpy2honwivb5zw',
          cravadas_fixas: 0,
        },

        // Bruno Xavier
        {
          id: '6uaqe0k861lckyl',
          nome: 'Bruno Xavier',
          bolao: 'kr20rfjisajd6ro',
          cravadas_fixas: 0,
        },
        {
          id: '2tt4qyld3zvxutb',
          nome: 'Bruno Xavier',
          bolao: 'xdtvijyapxuw99y',
          cravadas_fixas: 0,
        },
        {
          id: '5mec2j8sq1fneky',
          nome: 'Bruno Xavier',
          bolao: 'qdpy2honwivb5zw',
          cravadas_fixas: 0,
        },

        // Willian
        {
          id: '9fdrx5dij8dfobg',
          nome: 'Willian',
          bolao: 'kr20rfjisajd6ro',
          cravadas_fixas: 0,
        },
        {
          id: 'jj9o0g39qhf285f',
          nome: 'Willian',
          bolao: 'xdtvijyapxuw99y',
          cravadas_fixas: 0,
        },
        {
          id: 'qohuqdm775wzvoj',
          nome: 'Willian',
          bolao: 'qdpy2honwivb5zw',
          cravadas_fixas: 0,
        },
      ]

      for (let i = 0; i < cravadasOficiais.length; i++) {
        const item = cravadasOficiais[i]
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
            '[migration 0077] Cravadas fixas garantidas para ' +
              item.nome +
              ' no bolão ' +
              item.bolao +
              ': ' +
              item.cravadas_fixas,
          )
        }
      }

      console.log('[migration 0077] Concluído com sucesso.')
    } catch (err) {
      console.log('[migration 0077] Erro ao aplicar migração 0077:', err)
      throw err
    }
  },
  (app) => {
    // down migration
  },
)
