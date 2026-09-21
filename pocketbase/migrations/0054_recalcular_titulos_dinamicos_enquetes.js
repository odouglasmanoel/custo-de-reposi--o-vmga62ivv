migrate(
  (app) => {
    // Recalcula o título de todas as enquetes existentes no banco
    // Regra: "Enquete [Nome da Copa] — DD/MM/AAAA a DD/MM/AAAA"
    // baseado no primeiro (menor data/hora) e último (maior data/hora) jogo da enquete.
    const formatBR = (iso) => {
      if (!iso) return ''
      const parts = iso.split('-')
      if (parts.length === 3) {
        return parts[2] + '/' + parts[1] + '/' + parts[0]
      }
      return iso
    }

    const enquetes = app.findRecordsByFilter('enquetes', '', 'created', 100, 0)
    for (const enq of enquetes) {
      const jogos = app.findRecordsByFilter(
        'enquete_jogos',
        "enquete = '" + enq.id + "'",
        'data,horario',
        500,
        0,
      )

      let nomeCopa = 'Copa Coni'
      const curTitulo = enq.getString('titulo') || ''
      // Tenta preservar prefixo existente antes do traço/hífen se existir
      const matchPrefixo = curTitulo.match(/^(?:Enquete\s+)?([^\-—–]+)/i)
      if (matchPrefixo && matchPrefixo[1].trim()) {
        const parsedPrefixo = matchPrefixo[1].trim()
        // Se não for vazio e não tiver números/datas
        if (!/\d/.test(parsedPrefixo)) {
          nomeCopa = parsedPrefixo.replace(/^Enquete\s+/i, '').trim() || nomeCopa
        }
      }

      if (jogos.length > 0) {
        // Menor data/hora e maior data/hora
        const primeiro = jogos[0]
        const ultimo = jogos[jogos.length - 1]
        const dMin = primeiro.getString('data')
        const dMax = ultimo.getString('data')

        if (dMin && dMax) {
          const dMinBR = formatBR(dMin)
          const dMaxBR = formatBR(dMax)
          const novoTitulo = 'Enquete ' + nomeCopa + ' — ' + dMinBR + ' a ' + dMaxBR
          enq.set('titulo', novoTitulo)
          app.save(enq)
        }
      } else {
        // Fallback: usa data_inicio e data_fim pré-definidas
        const dInicio = enq.getString('data_inicio')
        const dFim = enq.getString('data_fim')
        if (dInicio && dFim) {
          const novoTitulo =
            'Enquete ' + nomeCopa + ' — ' + formatBR(dInicio) + ' a ' + formatBR(dFim)
          enq.set('titulo', novoTitulo)
          app.save(enq)
        }
      }
    }
  },
  (app) => {
    // Revert não é destrutivo
  },
)
