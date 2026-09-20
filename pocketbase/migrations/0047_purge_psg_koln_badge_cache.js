/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  // Purgar escudos incorretos do PSG / Paris Saint-Germain apontando para Colônia (192 / Köln / Cologne)
  const psgOfficialLogo = 'https://media.api-sports.io/football/teams/85.png'

  try {
    const enqJogos = app.findRecordsByFilter(
      'enquete_jogos',
      "time_a ~ 'Paris' || time_b ~ 'Paris' || time_a ~ 'PSG' || time_b ~ 'PSG' || logo_casa ~ 'koln' || logo_visitante ~ 'koln' || logo_casa ~ '192' || logo_visitante ~ '192'",
      '',
      100,
      0,
    )
    for (const rec of enqJogos) {
      let changed = false
      const ta = (rec.getString('time_a') || '').toLowerCase()
      const tb = (rec.getString('time_b') || '').toLowerCase()
      const lCasa = rec.getString('logo_casa') || ''
      const lVis = rec.getString('logo_visitante') || ''

      if (
        (ta.includes('paris') || ta === 'psg') &&
        (lCasa.includes('192') || lCasa.includes('koln') || lCasa.includes('cologne') || !lCasa)
      ) {
        rec.set('logo_casa', psgOfficialLogo)
        changed = true
      }
      if (
        (tb.includes('paris') || tb === 'psg') &&
        (lVis.includes('192') || lVis.includes('koln') || lVis.includes('cologne') || !lVis)
      ) {
        rec.set('logo_visitante', psgOfficialLogo)
        changed = true
      }
      if (changed) {
        app.save(rec)
      }
    }
  } catch (err) {
    console.log('[Migration 0047] Aviso ao purgar enquete_jogos:', err)
  }

  try {
    const manuais = app.findRecordsByFilter(
      'jogos_do_dia_manuais',
      "time_casa ~ 'Paris' || time_visitante ~ 'Paris' || time_casa ~ 'PSG' || time_visitante ~ 'PSG' || logo_casa ~ 'koln' || logo_visitante ~ 'koln' || logo_casa ~ '192' || logo_visitante ~ '192'",
      '',
      100,
      0,
    )
    for (const rec of manuais) {
      let changed = false
      const tc = (rec.getString('time_casa') || '').toLowerCase()
      const tv = (rec.getString('time_visitante') || '').toLowerCase()
      const lCasa = rec.getString('logo_casa') || ''
      const lVis = rec.getString('logo_visitante') || ''

      if (
        (tc.includes('paris') || tc === 'psg') &&
        (lCasa.includes('192') || lCasa.includes('koln') || lCasa.includes('cologne') || !lCasa)
      ) {
        rec.set('logo_casa', psgOfficialLogo)
        changed = true
      }
      if (
        (tv.includes('paris') || tv === 'psg') &&
        (lVis.includes('192') || lVis.includes('koln') || lVis.includes('cologne') || !lVis)
      ) {
        rec.set('logo_visitante', psgOfficialLogo)
        changed = true
      }
      if (changed) {
        app.save(rec)
      }
    }
  } catch (err) {
    console.log('[Migration 0047] Aviso ao purgar jogos_do_dia_manuais:', err)
  }
})
