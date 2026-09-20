/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  // Purga direta e definitiva no banco de dados para o registro/URL do Paris Saint-Germain
  // Mapeia permanentemente para https://media.api-sports.io/football/teams/85.png
  const psgOfficialLogo = 'https://media.api-sports.io/football/teams/85.png'

  // 1. Purga e atualização em enquete_jogos
  try {
    const enqJogos = app.findRecordsByFilter(
      'enquete_jogos',
      "time_a ~ 'Paris' || time_b ~ 'Paris' || time_a ~ 'PSG' || time_b ~ 'PSG' || logo_casa ~ 'koln' || logo_visitante ~ 'koln' || logo_casa ~ 'cologne' || logo_visitante ~ 'cologne' || logo_casa ~ '192' || logo_visitante ~ '192'",
      '',
      200,
      0,
    )
    for (const rec of enqJogos) {
      let changed = false
      const ta = (rec.getString('time_a') || '').toLowerCase().trim()
      const tb = (rec.getString('time_b') || '').toLowerCase().trim()

      if (
        ta.includes('paris') ||
        ta === 'psg' ||
        ta.includes('saint-germain') ||
        ta.includes('saint germain')
      ) {
        rec.set('logo_casa', psgOfficialLogo)
        changed = true
      }
      if (
        tb.includes('paris') ||
        tb === 'psg' ||
        tb.includes('saint-germain') ||
        tb.includes('saint germain')
      ) {
        rec.set('logo_visitante', psgOfficialLogo)
        changed = true
      }

      if (changed) {
        app.save(rec)
      }
    }
  } catch (err) {
    console.log('[Migration 0048] Aviso em enquete_jogos:', err)
  }

  // 2. Purga e atualização em jogos_do_dia_manuais
  try {
    const manuais = app.findRecordsByFilter(
      'jogos_do_dia_manuais',
      "time_casa ~ 'Paris' || time_visitante ~ 'Paris' || time_casa ~ 'PSG' || time_visitante ~ 'PSG' || logo_casa ~ 'koln' || logo_visitante ~ 'koln' || logo_casa ~ 'cologne' || logo_visitante ~ 'cologne' || logo_casa ~ '192' || logo_visitante ~ '192'",
      '',
      200,
      0,
    )
    for (const rec of manuais) {
      let changed = false
      const tc = (rec.getString('time_casa') || '').toLowerCase().trim()
      const tv = (rec.getString('time_visitante') || '').toLowerCase().trim()

      if (
        tc.includes('paris') ||
        tc === 'psg' ||
        tc.includes('saint-germain') ||
        tc.includes('saint germain')
      ) {
        rec.set('logo_casa', psgOfficialLogo)
        changed = true
      }
      if (
        tv.includes('paris') ||
        tv === 'psg' ||
        tv.includes('saint-germain') ||
        tv.includes('saint germain')
      ) {
        rec.set('logo_visitante', psgOfficialLogo)
        changed = true
      }

      if (changed) {
        app.save(rec)
      }
    }
  } catch (err) {
    console.log('[Migration 0048] Aviso em jogos_do_dia_manuais:', err)
  }

  // 3. Purga em fichas salvas ou escalações na collection jogos se houver referências a Köln no PSG
  try {
    const jogosPsg = app.findRecordsByFilter(
      'jogos',
      "time_a ~ 'Paris' || time_b ~ 'Paris' || time_a ~ 'PSG' || time_b ~ 'PSG'",
      '',
      100,
      0,
    )
    for (const rec of jogosPsg) {
      let changed = false
      // Verifica ficha_detalhes
      try {
        const ficha = rec.get('ficha_detalhes')
        if (ficha && typeof ficha === 'object') {
          if (
            ficha.teams &&
            ficha.teams.home &&
            (rec.getString('time_a').toLowerCase().includes('paris') ||
              rec.getString('time_a').toLowerCase() === 'psg')
          ) {
            if (ficha.teams.home.logo !== psgOfficialLogo) {
              ficha.teams.home.logo = psgOfficialLogo
              changed = true
            }
          }
          if (
            ficha.teams &&
            ficha.teams.away &&
            (rec.getString('time_b').toLowerCase().includes('paris') ||
              rec.getString('time_b').toLowerCase() === 'psg')
          ) {
            if (ficha.teams.away.logo !== psgOfficialLogo) {
              ficha.teams.away.logo = psgOfficialLogo
              changed = true
            }
          }
          if (changed) {
            rec.set('ficha_detalhes', ficha)
          }
        }
      } catch (_) {}

      // Verifica escalacoes
      try {
        const esc = rec.get('escalacoes')
        if (esc && typeof esc === 'object' && Array.isArray(esc.teams)) {
          for (const t of esc.teams) {
            const tName = (t.teamName || '').toLowerCase()
            if (tName.includes('paris') || tName === 'psg') {
              if (t.teamLogo !== psgOfficialLogo) {
                t.teamLogo = psgOfficialLogo
                changed = true
              }
            }
          }
          if (changed) {
            rec.set('escalacoes', esc)
          }
        }
      } catch (_) {}

      if (changed) {
        app.save(rec)
      }
    }
  } catch (err) {
    console.log('[Migration 0048] Aviso em jogos:', err)
  }
})
