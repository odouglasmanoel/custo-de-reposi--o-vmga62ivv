migrate(
  (app) => {
    // Migration 0079: Atualizar a base fixa de cravadas históricas apuradas na auditoria manual
    // RIGOROSAMENTE estes valores por participante/copa:
    // - Bruno Xavier: Copa do Mundo: 6 | Copa Genilton: 0 | Copa Sormani: 1 | Copa Coni: 1 (Total = 8)
    // - Davi: Copa do Mundo: 10 | Copa Genilton: 6 | Copa Sormani: 3 | Copa Coni: 6 (Total = 25)
    // - Douglas: Copa do Mundo: 8 | Copa Genilton: 3 | Copa Sormani: 2 | Copa Coni: 6 (Total = 19)
    // - Gabriel: Copa do Mundo: 7 | Copa Genilton: 5 | Copa Sormani: 5 | Copa Coni: 4 (Total = 21)
    //
    // IDs dos Bolões:
    // - Copa do Mundo: hy6ade9obylh404
    // - Copa Coni: kr20rfjisajd6ro
    // - Copa Sormani: xdtvijyapxuw99y
    // - Copa Genilton: qdpy2honwivb5zw
    //
    // PONTUAÇÕES TOTAIS E PONTOS IMPORTADOS FICAM 100% INTACTOS E CONGELADOS.
    try {
      const col = app.findCollectionByNameOrId('participantes')

      // Garantir campo cravadas_fixas
      if (!col.fields.getByName('cravadas_fixas')) {
        col.fields.add(
          new NumberField({
            name: 'cravadas_fixas',
            onlyInt: true,
          }),
        )
        app.save(col)
      }

      // Garantir que Bruno Xavier exista no bolão Copa do Mundo (hy6ade9obylh404) para receber suas 6 cravadas fixas da auditoria
      const BOLAOS = {
        copaDoMundo: 'hy6ade9obylh404',
        copaConi: 'kr20rfjisajd6ro',
        copaSormani: 'xdtvijyapxuw99y',
        copaGenilton: 'qdpy2honwivb5zw',
      }

      let bxCopaMundo = null
      try {
        const matches = app.findRecordsByFilter(
          'participantes',
          "bolao = '" + BOLAOS.copaDoMundo + "' && (nome = 'Bruno Xavier' || nome = 'brunox')",
          '',
          1,
          0,
        )
        if (matches.length > 0) bxCopaMundo = matches[0]
      } catch (_) {}

      if (!bxCopaMundo) {
        bxCopaMundo = new Record(col)
        bxCopaMundo.set('bolao', BOLAOS.copaDoMundo)
        bxCopaMundo.set('nome', 'Bruno Xavier')
        bxCopaMundo.set('pontos_importados', 0)
        bxCopaMundo.set('pontuacao_total', 0)
        bxCopaMundo.set('cravadas_fixas', 6)
        app.save(bxCopaMundo)
        console.log(
          '[migration 0079] Participante Bruno Xavier criado na Copa do Mundo com 6 cravadas fixas.',
        )
      }

      // Valores apurados na auditoria
      const cravadasAuditoria = [
        // Bruno Xavier: Copa do Mundo: 6 | Copa Genilton: 0 | Copa Sormani: 1 | Copa Coni: 1 (Total = 8)
        { nome: 'Bruno Xavier', bolao: BOLAOS.copaDoMundo, cravadas_fixas: 6 },
        { nome: 'Bruno Xavier', bolao: BOLAOS.copaGenilton, cravadas_fixas: 0 },
        { nome: 'Bruno Xavier', bolao: BOLAOS.copaSormani, cravadas_fixas: 1 },
        { nome: 'Bruno Xavier', bolao: BOLAOS.copaConi, cravadas_fixas: 1 },

        // Davi: Copa do Mundo: 10 | Copa Genilton: 6 | Copa Sormani: 3 | Copa Coni: 6 (Total = 25)
        { nome: 'Davi', bolao: BOLAOS.copaDoMundo, cravadas_fixas: 10 },
        { nome: 'Davi', bolao: BOLAOS.copaGenilton, cravadas_fixas: 6 },
        { nome: 'Davi', bolao: BOLAOS.copaSormani, cravadas_fixas: 3 },
        { nome: 'Davi', bolao: BOLAOS.copaConi, cravadas_fixas: 6 },

        // Douglas: Copa do Mundo: 8 | Copa Genilton: 3 | Copa Sormani: 2 | Copa Coni: 6 (Total = 19)
        { nome: 'Douglas', bolao: BOLAOS.copaDoMundo, cravadas_fixas: 8 },
        { nome: 'Douglas', bolao: BOLAOS.copaGenilton, cravadas_fixas: 3 },
        { nome: 'Douglas', bolao: BOLAOS.copaSormani, cravadas_fixas: 2 },
        { nome: 'Douglas', bolao: BOLAOS.copaConi, cravadas_fixas: 6 },

        // Gabriel: Copa do Mundo: 7 | Copa Genilton: 5 | Copa Sormani: 5 | Copa Coni: 4 (Total = 21)
        { nome: 'Gabriel', bolao: BOLAOS.copaDoMundo, cravadas_fixas: 7 },
        { nome: 'Gabriel', bolao: BOLAOS.copaGenilton, cravadas_fixas: 5 },
        { nome: 'Gabriel', bolao: BOLAOS.copaSormani, cravadas_fixas: 5 },
        { nome: 'Gabriel', bolao: BOLAOS.copaConi, cravadas_fixas: 4 },

        // Bruno Lopes: manter 0 por copa
        { nome: 'Bruno Lopes', bolao: BOLAOS.copaDoMundo, cravadas_fixas: 0 },
        { nome: 'Bruno Lopes', bolao: BOLAOS.copaGenilton, cravadas_fixas: 0 },
        { nome: 'Bruno Lopes', bolao: BOLAOS.copaSormani, cravadas_fixas: 0 },
        { nome: 'Bruno Lopes', bolao: BOLAOS.copaConi, cravadas_fixas: 0 },

        // Willian: manter 0 por copa
        { nome: 'Willian', bolao: BOLAOS.copaGenilton, cravadas_fixas: 0 },
        { nome: 'Willian', bolao: BOLAOS.copaSormani, cravadas_fixas: 0 },
        { nome: 'Willian', bolao: BOLAOS.copaConi, cravadas_fixas: 0 },
      ]

      for (let i = 0; i < cravadasAuditoria.length; i++) {
        const item = cravadasAuditoria[i]
        try {
          const filter = "bolao = '" + item.bolao + "' && nome = '" + item.nome + "'"
          const records = app.findRecordsByFilter('participantes', filter, '', 1, 0)
          if (records.length > 0) {
            const rec = records[0]
            rec.set('cravadas_fixas', item.cravadas_fixas)
            app.save(rec)
            console.log(
              '[migration 0079] Gravado cravadas_fixas = ' +
                item.cravadas_fixas +
                ' para ' +
                item.nome +
                ' no bolao ' +
                item.bolao,
            )
          } else {
            console.log(
              '[migration 0079] Registro não encontrado para ' +
                item.nome +
                ' no bolao ' +
                item.bolao,
            )
          }
        } catch (errRec) {
          console.log(
            '[migration 0079] Erro ao gravar para ' + item.nome + ' no bolao ' + item.bolao + ':',
            errRec,
          )
        }
      }

      console.log('[migration 0079] Concluída com sucesso.')
    } catch (err) {
      console.log('[migration 0079] Erro fatal na migração:', err)
      throw err
    }
  },
  (app) => {
    // down migration
  },
)
