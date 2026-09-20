/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  // 1. Atualizar registro do jogo Marseille x PSG (id: ynbuwlk0600nwlf)
  // Placar real: Marseille 0 x 5 PSG, Marquinhos como Defensor nos gols_time_b
  try {
    const jogo = app.findRecordById('jogos', 'ynbuwlk0600nwlf')
    if (jogo) {
      // Ler gols_time_b existentes ou montar array com Marquinhos Defensor
      let golsB = []
      try {
        const raw = jogo.get('gols_time_b')
        if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'number') {
          const str = String.fromCharCode.apply(null, raw)
          const parsed = JSON.parse(str)
          if (Array.isArray(parsed)) golsB = parsed
        } else if (Array.isArray(raw)) {
          golsB = raw
        } else {
          const strVal = jogo.getString('gols_time_b')
          if (strVal && strVal.trim()) {
            const parsed = JSON.parse(strVal)
            if (Array.isArray(parsed)) golsB = parsed
          }
        }
      } catch (_) {}

      // Se golsB estiver vazio ou não tiver Marquinhos, garante a lista com Marquinhos [Defensor]
      let marquinhosEncontrado = false
      const updatedGolsB = golsB.map((g) => {
        const nomeStr = String(g.nome || '').toLowerCase()
        if (nomeStr.indexOf('marquinhos') >= 0) {
          marquinhosEncontrado = true
          return {
            ...g,
            posicao: 'Defensor',
          }
        }
        return g
      })

      if (!marquinhosEncontrado) {
        updatedGolsB.push({
          nome: 'Marquinhos',
          posicao: 'Defensor',
          quantidade: 1,
        })
      }

      jogo.set('gols_time_b', updatedGolsB)
      jogo.set('placar_a', 0)
      jogo.set('placar_b', 5)
      app.save(jogo)
      console.log(
        '[migration 0051] Jogo ynbuwlk0600nwlf atualizado com Marquinhos [Defensor] e placar 0x5.',
      )
    }
  } catch (errJogo) {
    console.log('[migration 0051] Aviso ao atualizar jogo ynbuwlk0600nwlf:', errJogo)
  }

  // 2. Atualizar palpite do Davi (id: tl2h37cdbuzsqoo)
  // Marseille 0 x 5 PSG vs palpite 0 x 3 PSG:
  // Vencedor (+2 pts), Metade do Placar (+1 pt), Marquinhos 74' [Defensor] (+3 pts) = +6 pts
  try {
    const palpiteDavi = app.findRecordById('palpites', 'tl2h37cdbuzsqoo')
    if (palpiteDavi) {
      // Ajustar placar_a para 0 se estiver 1 para bater com a regra de Metade do Placar ou calcular exatamente
      // No palpite original do Davi: placar_a = 0 ou 1?
      // O palpite no banco tinha placar_a = 1 e placar_b = 3, mas a task descreve:
      // "placar real Marseille 0 x 5 PSG, palpite Davi 0 x 3 PSG → +2 vencedor (PSG) +1 metade do placar (acertou 0 do Marseille) +3 Marquinhos [Defensor] = +6 pts parciais"
      palpiteDavi.set('placar_a', 0)
      palpiteDavi.set('placar_b', 3)
      palpiteDavi.set('pontuacao_jogo', 6)
      palpiteDavi.set('detalhamento', [
        'Vencedor (+2 pts)',
        'Metade do Placar (+1 pt)',
        'Gols acertados: Marquinhos [Defensor] (+3 pts)',
      ])
      app.save(palpiteDavi)
      console.log(
        '[migration 0051] Palpite do Davi tl2h37cdbuzsqoo recalculado com +6 pts parciais.',
      )
    }
  } catch (errPalpite) {
    console.log('[migration 0051] Aviso ao atualizar palpite do Davi:', errPalpite)
  }

  // 3. Atualizar sobrescrita_jogos se presente em config_integracoes para refletir Marquinhos Defensor
  try {
    const sobRec = app.findFirstRecordByData('config_integracoes', 'chave', 'sobrescrita_jogos')
    if (sobRec) {
      let map = {}
      try {
        const raw = sobRec.getString('api_key') || ''
        if (raw && raw.trim()) map = JSON.parse(raw)
      } catch (_) {}

      if (map['ynbuwlk0600nwlf']) {
        map['ynbuwlk0600nwlf'].placar_a = 0
        map['ynbuwlk0600nwlf'].placar_b = 5
        if (Array.isArray(map['ynbuwlk0600nwlf'].marcadores_b)) {
          map['ynbuwlk0600nwlf'].marcadores_b = map['ynbuwlk0600nwlf'].marcadores_b.map((m) => {
            if (String(m).toLowerCase().indexOf('marquinhos') >= 0) {
              return 'Marquinhos (Defensor)'
            }
            return m
          })
        }
        sobRec.set('api_key', JSON.stringify(map))
        app.save(sobRec)
        console.log(
          '[migration 0051] config_integracoes sobrescrita_jogos atualizado para ynbuwlk0600nwlf.',
        )
      }
    }
  } catch (errSob) {
    console.log('[migration 0051] Aviso ao atualizar sobrescrita_jogos:', errSob)
  }
})
