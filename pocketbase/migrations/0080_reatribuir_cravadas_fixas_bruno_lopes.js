migrate(
  (app) => {
    // Migration 0080: Reatribuição da base fixa de cravadas históricas
    // Bruno Lopes passa a ser o participante histórico das planilhas:
    // - Bruno Lopes: Copa do Mundo: 6 | Copa Genilton: 0 | Copa Sormani: 1 | Copa Coni: 1 (Total = 8)
    // Bruno Xavier zera a base de planilhas:
    // - Bruno Xavier: Copa do Mundo: 0 | Copa Genilton: 0 | Copa Sormani: 0 | Copa Coni: 0 (Total = 0)
    // Davi, Douglas e Gabriel permanecem exatamente como estão.
    // PONTUAÇÕES TOTAIS E PONTOS IMPORTADOS FICAM 100% INTACTOS E CONGELADOS.
    try {
      const BOLAOS = {
        copaDoMundo: 'hy6ade9obylh404',
        copaConi: 'kr20rfjisajd6ro',
        copaSormani: 'xdtvijyapxuw99y',
        copaGenilton: 'qdpy2honwivb5zw',
      }

      const updates = [
        // Bruno Lopes: Copa do Mundo: 6 | Copa Genilton: 0 | Copa Sormani: 1 | Copa Coni: 1 (Total = 8)
        { nome: 'Bruno Lopes', bolao: BOLAOS.copaDoMundo, cravadas_fixas: 6 },
        { nome: 'Bruno Lopes', bolao: BOLAOS.copaGenilton, cravadas_fixas: 0 },
        { nome: 'Bruno Lopes', bolao: BOLAOS.copaSormani, cravadas_fixas: 1 },
        { nome: 'Bruno Lopes', bolao: BOLAOS.copaConi, cravadas_fixas: 1 },

        // Bruno Xavier: zera a base de planilhas (0 em todas as copas)
        { nome: 'Bruno Xavier', bolao: BOLAOS.copaDoMundo, cravadas_fixas: 0 },
        { nome: 'Bruno Xavier', bolao: BOLAOS.copaGenilton, cravadas_fixas: 0 },
        { nome: 'Bruno Xavier', bolao: BOLAOS.copaSormani, cravadas_fixas: 0 },
        { nome: 'Bruno Xavier', bolao: BOLAOS.copaConi, cravadas_fixas: 0 },

        // Davi (25: 10/6/3/6) - confirmação
        { nome: 'Davi', bolao: BOLAOS.copaDoMundo, cravadas_fixas: 10 },
        { nome: 'Davi', bolao: BOLAOS.copaGenilton, cravadas_fixas: 6 },
        { nome: 'Davi', bolao: BOLAOS.copaSormani, cravadas_fixas: 3 },
        { nome: 'Davi', bolao: BOLAOS.copaConi, cravadas_fixas: 6 },

        // Douglas (19: 8/3/2/6) - confirmação
        { nome: 'Douglas', bolao: BOLAOS.copaDoMundo, cravadas_fixas: 8 },
        { nome: 'Douglas', bolao: BOLAOS.copaGenilton, cravadas_fixas: 3 },
        { nome: 'Douglas', bolao: BOLAOS.copaSormani, cravadas_fixas: 2 },
        { nome: 'Douglas', bolao: BOLAOS.copaConi, cravadas_fixas: 6 },

        // Gabriel (21: 7/5/5/4) - confirmação
        { nome: 'Gabriel', bolao: BOLAOS.copaDoMundo, cravadas_fixas: 7 },
        { nome: 'Gabriel', bolao: BOLAOS.copaGenilton, cravadas_fixas: 5 },
        { nome: 'Gabriel', bolao: BOLAOS.copaSormani, cravadas_fixas: 5 },
        { nome: 'Gabriel', bolao: BOLAOS.copaConi, cravadas_fixas: 4 },

        // Willian: manter 0 por copa
        { nome: 'Willian', bolao: BOLAOS.copaGenilton, cravadas_fixas: 0 },
        { nome: 'Willian', bolao: BOLAOS.copaSormani, cravadas_fixas: 0 },
        { nome: 'Willian', bolao: BOLAOS.copaConi, cravadas_fixas: 0 },
      ]

      for (let i = 0; i < updates.length; i++) {
        const item = updates[i]
        try {
          const filter = "bolao = '" + item.bolao + "' && nome = '" + item.nome + "'"
          const records = app.findRecordsByFilter('participantes', filter, '', 1, 0)
          if (records.length > 0) {
            const rec = records[0]
            rec.set('cravadas_fixas', item.cravadas_fixas)
            app.save(rec)
            console.log(
              '[migration 0080] Gravado cravadas_fixas = ' +
                item.cravadas_fixas +
                ' para ' +
                item.nome +
                ' no bolao ' +
                item.bolao,
            )
          } else {
            console.log(
              '[migration 0080] Registro não encontrado para ' +
                item.nome +
                ' no bolao ' +
                item.bolao,
            )
          }
        } catch (errRec) {
          console.log(
            '[migration 0080] Erro ao gravar para ' + item.nome + ' no bolao ' + item.bolao + ':',
            errRec,
          )
        }
      }

      console.log('[migration 0080] Concluída com sucesso.')
    } catch (err) {
      console.log('[migration 0080] Erro fatal na migração 0080:', err)
      throw err
    }
  },
  (app) => {
    // down migration
  },
)
