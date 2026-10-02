/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    console.log(
      '[migration 0099] Iniciando varredura sistêmica e re-resolução de escudos em enquete_jogos e jogos...',
    )

    const CANONICAL_CLUB_MAP = {
      // 1. Red Bull Bragantino (team 1199)
      redbullbragantino: 'https://media.api-sports.io/football/teams/1199.png',
      rbbragantino: 'https://media.api-sports.io/football/teams/1199.png',
      bragantino: 'https://media.api-sports.io/football/teams/1199.png',

      // 2. Mirassol (team 10214)
      mirassol: 'https://media.api-sports.io/football/teams/10214.png',
      mirassolfc: 'https://media.api-sports.io/football/teams/10214.png',

      // 3. Remo (team 10213)
      remo: 'https://media.api-sports.io/football/teams/10213.png',
      clubedoremo: 'https://media.api-sports.io/football/teams/10213.png',

      // 4. Grêmio (team 130)
      gremio: 'https://media.api-sports.io/football/teams/130.png',
      gremiofbpa: 'https://media.api-sports.io/football/teams/130.png',

      // 5. Chapecoense (team 147)
      chapecoense: 'https://media.api-sports.io/football/teams/147.png',
      chapecoenseaf: 'https://media.api-sports.io/football/teams/147.png',
      chape: 'https://media.api-sports.io/football/teams/147.png',
      acf: 'https://media.api-sports.io/football/teams/147.png',

      // 6. Coritiba (team 132)
      coritiba: 'https://media.api-sports.io/football/teams/132.png',
      coritibafbc: 'https://media.api-sports.io/football/teams/132.png',
      coxa: 'https://media.api-sports.io/football/teams/132.png',
      cfc: 'https://media.api-sports.io/football/teams/132.png',

      // 7. Vitória (team 136)
      vitoria: 'https://media.api-sports.io/football/teams/136.png',
      ecvitoria: 'https://media.api-sports.io/football/teams/136.png',

      // 8. Botafogo (team 120)
      botafogo: 'https://media.api-sports.io/football/teams/120.png',
      botafogorj: 'https://media.api-sports.io/football/teams/120.png',
      bfr: 'https://media.api-sports.io/football/teams/120.png',

      // 9. Vasco (team 133)
      vasco: 'https://media.api-sports.io/football/teams/133.png',
      vascodagama: 'https://media.api-sports.io/football/teams/133.png',
      crvascodagama: 'https://media.api-sports.io/football/teams/133.png',

      // 10. Cruzeiro (team 135)
      cruzeiro: 'https://media.api-sports.io/football/teams/135.png',
      cruzeiroec: 'https://media.api-sports.io/football/teams/135.png',

      // 11. São Paulo (team 126)
      saopaulo: 'https://media.api-sports.io/football/teams/126.png',
      spfc: 'https://media.api-sports.io/football/teams/126.png',

      // 12. Santos (team 128)
      santos: 'https://media.api-sports.io/football/teams/128.png',
      santosfc: 'https://media.api-sports.io/football/teams/128.png',

      // 13. Fluminense (team 124)
      fluminense: 'https://media.api-sports.io/football/teams/124.png',
      fluminensefc: 'https://media.api-sports.io/football/teams/124.png',

      // 14. Flamengo (team 127)
      flamengo: 'https://media.api-sports.io/football/teams/127.png',
      crflamengo: 'https://media.api-sports.io/football/teams/127.png',

      // 15. Palmeiras (team 121)
      palmeiras: 'https://media.api-sports.io/football/teams/121.png',
      sepalmeiras: 'https://media.api-sports.io/football/teams/121.png',

      // 16. Bahia (team 118)
      bahia: 'https://media.api-sports.io/football/teams/118.png',
      ecbahia: 'https://media.api-sports.io/football/teams/118.png',

      // 17. Athletico-PR (team 134)
      athleticopr: 'https://media.api-sports.io/football/teams/134.png',
      athletico: 'https://media.api-sports.io/football/teams/134.png',
      athleticoparanaense: 'https://media.api-sports.io/football/teams/134.png',
      atleticopr: 'https://media.api-sports.io/football/teams/134.png',

      // 18. Atlético-MG (team 1062)
      atleticomineiro: 'https://media.api-sports.io/football/teams/1062.png',
      atleticomg: 'https://media.api-sports.io/football/teams/1062.png',
      cam: 'https://media.api-sports.io/football/teams/1062.png',

      // 19. Internacional (team 119)
      internacional: 'https://media.api-sports.io/football/teams/119.png',
      inter: 'https://media.api-sports.io/football/teams/119.png',
      sci: 'https://media.api-sports.io/football/teams/119.png',

      // 20. Corinthians (team 131)
      corinthians: 'https://media.api-sports.io/football/teams/131.png',
      sccorinthianspaulista: 'https://media.api-sports.io/football/teams/131.png',
      sccp: 'https://media.api-sports.io/football/teams/131.png',

      // Demais clubes nacionais relevantes
      criciuma: 'https://media.api-sports.io/football/teams/140.png',
      criciumaec: 'https://media.api-sports.io/football/teams/140.png',
      cuiaba: 'https://media.api-sports.io/football/teams/1200.png',
      cuiabaec: 'https://media.api-sports.io/football/teams/1200.png',
      fortaleza: 'https://media.api-sports.io/football/teams/154.png',
      fortalezaec: 'https://media.api-sports.io/football/teams/154.png',
      juventude: 'https://media.api-sports.io/football/teams/152.png',
      ecjuventude: 'https://media.api-sports.io/football/teams/152.png',
      goias: 'https://media.api-sports.io/football/teams/144.png',
      sport: 'https://media.api-sports.io/football/teams/794.png',
      sportrecife: 'https://media.api-sports.io/football/teams/794.png',
      ceara: 'https://media.api-sports.io/football/teams/129.png',
      avai: 'https://media.api-sports.io/football/teams/138.png',

      // Internacionais recorrentes
      psg: 'https://media.api-sports.io/football/teams/85.png',
      parissaintgermain: 'https://media.api-sports.io/football/teams/85.png',
      realmadrid: 'https://media.api-sports.io/football/teams/541.png',
      barcelona: 'https://media.api-sports.io/football/teams/529.png',
      manchestercity: 'https://media.api-sports.io/football/teams/50.png',
      liverpool: 'https://media.api-sports.io/football/teams/40.png',
      arsenal: 'https://media.api-sports.io/football/teams/42.png',
      chelsea: 'https://media.api-sports.io/football/teams/49.png',
      bayernmunich: 'https://media.api-sports.io/football/teams/157.png',
      bayernmunique: 'https://media.api-sports.io/football/teams/157.png',
    }

    const CANONICAL_SELECOES_FLAGS = {
      brasil: 'https://flagcdn.com/w80/br.png',
      brazil: 'https://flagcdn.com/w80/br.png',
      argentina: 'https://flagcdn.com/w80/ar.png',
      franca: 'https://flagcdn.com/w80/fr.png',
      france: 'https://flagcdn.com/w80/fr.png',
      alemanha: 'https://flagcdn.com/w80/de.png',
      germany: 'https://flagcdn.com/w80/de.png',
      espanha: 'https://flagcdn.com/w80/es.png',
      spain: 'https://flagcdn.com/w80/es.png',
      inglaterra: 'https://flagcdn.com/w80/gb-eng.png',
      england: 'https://flagcdn.com/w80/gb-eng.png',
      portugal: 'https://flagcdn.com/w80/pt.png',
      italia: 'https://flagcdn.com/w80/it.png',
      italy: 'https://flagcdn.com/w80/it.png',
      holanda: 'https://flagcdn.com/w80/nl.png',
      paisesbaixos: 'https://flagcdn.com/w80/nl.png',
      netherlands: 'https://flagcdn.com/w80/nl.png',
      belgica: 'https://flagcdn.com/w80/be.png',
      belgium: 'https://flagcdn.com/w80/be.png',
      croacia: 'https://flagcdn.com/w80/hr.png',
      croatia: 'https://flagcdn.com/w80/hr.png',
      uruguai: 'https://flagcdn.com/w80/uy.png',
      uruguay: 'https://flagcdn.com/w80/uy.png',
      dinamarca: 'https://flagcdn.com/w80/dk.png',
      denmark: 'https://flagcdn.com/w80/dk.png',
      noruega: 'https://flagcdn.com/w80/no.png',
      norway: 'https://flagcdn.com/w80/no.png',
      turquia: 'https://flagcdn.com/w80/tr.png',
      turkey: 'https://flagcdn.com/w80/tr.png',
      estadosunidos: 'https://flagcdn.com/w80/us.png',
      usa: 'https://flagcdn.com/w80/us.png',
      mexico: 'https://flagcdn.com/w80/mx.png',
      chile: 'https://flagcdn.com/w80/cl.png',
      colombia: 'https://flagcdn.com/w80/co.png',
      peru: 'https://flagcdn.com/w80/pe.png',
      equador: 'https://flagcdn.com/w80/ec.png',
      paraguai: 'https://flagcdn.com/w80/py.png',
      venezuela: 'https://flagcdn.com/w80/ve.png',
      bolivia: 'https://flagcdn.com/w80/bo.png',
      japao: 'https://flagcdn.com/w80/jp.png',
      coreiadosul: 'https://flagcdn.com/w80/kr.png',
      marrocos: 'https://flagcdn.com/w80/ma.png',
      senegal: 'https://flagcdn.com/w80/sn.png',
      suica: 'https://flagcdn.com/w80/ch.png',
      suecia: 'https://flagcdn.com/w80/se.png',
      polonia: 'https://flagcdn.com/w80/pl.png',
      grecia: 'https://flagcdn.com/w80/gr.png',
      escocia: 'https://flagcdn.com/w80/gb-sct.png',
      paisdegales: 'https://flagcdn.com/w80/gb-wls.png',
      gales: 'https://flagcdn.com/w80/gb-wls.png',
      irlandadonorte: 'https://flagcdn.com/w80/gb-nir.png',
      georgia: 'https://flagcdn.com/w80/ge.png',
      lituania: 'https://flagcdn.com/w80/lt.png',
      azerbaijao: 'https://flagcdn.com/w80/az.png',
    }

    function normalizeKey(str) {
      if (!str) return ''
      var s = String(str).toLowerCase()
      try {
        s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      } catch (_) {}
      s = s.replace(/[^a-z0-9]/g, '').trim()
      return s
    }

    function resolverEscudoCanônico(teamName) {
      var k = normalizeKey(teamName)
      if (!k) return null
      if (CANONICAL_CLUB_MAP[k]) return CANONICAL_CLUB_MAP[k]
      if (CANONICAL_SELECOES_FLAGS[k]) return CANONICAL_SELECOES_FLAGS[k]
      return null
    }

    function isUrlIncorretaParaTime(teamName, url) {
      if (!url) return true
      if (url.indexOf('thesportsdb.com') !== -1) return true
      var k = normalizeKey(teamName)

      // Regras estritas de troca observadas no print:
      // Bragantino com escudo de Grêmio (130)
      if (
        (k === 'redbullbragantino' || k === 'bragantino' || k === 'rbbragantino') &&
        url.indexOf('/130.') !== -1
      )
        return true

      // Remo com escudo de Palmeiras (121)
      if (k === 'remo' && url.indexOf('/121.') !== -1) return true

      // Chapecoense com escudo de Coritiba (132)
      if (
        (k === 'chapecoense' || k === 'chapecoenseaf' || k === 'chape' || k === 'acf') &&
        url.indexOf('/132.') !== -1
      )
        return true

      // Coritiba com escudo de Chapecoense (147)
      if (
        (k === 'coritiba' || k === 'coritibafbc' || k === 'coxa' || k === 'cfc') &&
        url.indexOf('/147.') !== -1
      )
        return true

      // Cruzeiro com escudo de Coritiba (132)
      if (k === 'cruzeiro' && url.indexOf('/132.') !== -1) return true

      // Vitória com escudo de Criciúma (140)
      if ((k === 'vitoria' || k === 'ecvitoria') && url.indexOf('/140.') !== -1) return true

      // B.S.C. corrompido / z3v04x
      if (url.indexOf('z3v04x') !== -1 || url.indexOf('bsc') !== -1) return true

      return false
    }

    // 1. Atualização e limpeza em enquete_jogos
    try {
      var allEJ = app.findRecordsByFilter('enquete_jogos', '', '', 1000, 0)
      var totalEJ = 0
      for (var i = 0; i < allEJ.length; i++) {
        var ej = allEJ[i]
        var tA = ej.getString('time_a') || ''
        var tB = ej.getString('time_b') || ''
        var logoA = ej.getString('logo_casa') || ''
        var logoB = ej.getString('logo_visitante') || ''
        var changed = false

        var canonA = resolverEscudoCanônico(tA)
        var canonB = resolverEscudoCanônico(tB)

        if (canonA && (isUrlIncorretaParaTime(tA, logoA) || logoA !== canonA)) {
          ej.set('logo_casa', canonA)
          changed = true
        }

        if (canonB && (isUrlIncorretaParaTime(tB, logoB) || logoB !== canonB)) {
          ej.set('logo_visitante', canonB)
          changed = true
        }

        if (changed) {
          app.save(ej)
          totalEJ++
          console.log(
            '[migration 0099] enquete_jogos #' +
              ej.id +
              ' (' +
              tA +
              ' x ' +
              tB +
              ') corrigido com escudos canônicos.',
          )
        }
      }
      console.log(
        '[migration 0099] Total de registros enquete_jogos atualizados com sucesso: ' + totalEJ,
      )
    } catch (errEJ) {
      console.log('[migration 0099] Erro ao varrer enquete_jogos:', errEJ)
    }

    // 2. Atualização e limpeza em jogos
    try {
      var allJ = app.findRecordsByFilter('jogos', '', '', 2000, 0)
      var totalJ = 0
      for (var j = 0; j < allJ.length; j++) {
        var jg = allJ[j]
        var jA = jg.getString('time_a') || ''
        var jB = jg.getString('time_b') || ''
        var jLogoA = jg.getString('url_escudo_mandante') || ''
        var jLogoB = jg.getString('url_escudo_visitante') || ''
        var jChanged = false

        var jCanonA = resolverEscudoCanônico(jA)
        var jCanonB = resolverEscudoCanônico(jB)

        if (jCanonA && (isUrlIncorretaParaTime(jA, jLogoA) || jLogoA !== jCanonA)) {
          jg.set('url_escudo_mandante', jCanonA)
          jChanged = true
        }

        if (jCanonB && (isUrlIncorretaParaTime(jB, jLogoB) || jLogoB !== jCanonB)) {
          jg.set('url_escudo_visitante', jCanonB)
          jChanged = true
        }

        if (jChanged) {
          app.save(jg)
          totalJ++
          console.log(
            '[migration 0099] jogos #' +
              jg.id +
              ' (' +
              jA +
              ' x ' +
              jB +
              ') corrigido com escudos canônicos.',
          )
        }
      }
      console.log('[migration 0099] Total de registros jogos atualizados com sucesso: ' + totalJ)
    } catch (errJ) {
      console.log('[migration 0099] Erro ao varrer jogos:', errJ)
    }

    console.log('[migration 0099] Varredura sistêmica concluída com sucesso.')
  },
  (app) => {},
)
