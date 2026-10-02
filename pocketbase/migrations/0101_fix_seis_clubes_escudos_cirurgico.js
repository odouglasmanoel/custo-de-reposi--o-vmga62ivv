// pocketbase/migrations/0101_fix_seis_clubes_escudos_cirurgico.js
// Correção cirúrgica de escudos/logos de APENAS 6 times específicos:
// 1. Estudiantes de La Plata -> https://media.api-sports.io/football/teams/450.png
// 2. Chapecoense (ACF) -> https://media.api-sports.io/football/teams/147.png
// 3. Coritiba (CFC) -> https://media.api-sports.io/football/teams/132.png
// 4. Red Bull Bragantino -> https://media.api-sports.io/football/teams/1199.png
// 5. Mirassol FC -> https://media.api-sports.io/football/teams/10214.png
// 6. Clube do Remo -> https://media.api-sports.io/football/teams/10213.png
//
// REGRA ABSOLUTA: Boca Juniors está CORRETO — NÃO mexer no Boca Juniors.

migrate(
  (app) => {
    console.log(
      '[migration 0101] Iniciando correção cirúrgica de escudos dos 6 clubes específicos...',
    )

    var TARGET_CLUBS = {
      // 1. Estudiantes de La Plata
      estudiantes: 'https://media.api-sports.io/football/teams/450.png',
      estudiantesdelaplata: 'https://media.api-sports.io/football/teams/450.png',
      estudianteslp: 'https://media.api-sports.io/football/teams/450.png',
      estudanteslp: 'https://media.api-sports.io/football/teams/450.png',
      est: 'https://media.api-sports.io/football/teams/450.png',

      // 2. Chapecoense (ACF)
      chapecoense: 'https://media.api-sports.io/football/teams/147.png',
      chapecoenseaf: 'https://media.api-sports.io/football/teams/147.png',
      chape: 'https://media.api-sports.io/football/teams/147.png',
      acf: 'https://media.api-sports.io/football/teams/147.png',

      // 3. Coritiba (CFC)
      coritiba: 'https://media.api-sports.io/football/teams/132.png',
      coritibafbc: 'https://media.api-sports.io/football/teams/132.png',
      coxa: 'https://media.api-sports.io/football/teams/132.png',
      cfc: 'https://media.api-sports.io/football/teams/132.png',

      // 4. Red Bull Bragantino
      redbullbragantino: 'https://media.api-sports.io/football/teams/1199.png',
      bragantino: 'https://media.api-sports.io/football/teams/1199.png',
      rbbragantino: 'https://media.api-sports.io/football/teams/1199.png',

      // 5. Mirassol
      mirassol: 'https://media.api-sports.io/football/teams/10214.png',
      mirassolfc: 'https://media.api-sports.io/football/teams/10214.png',

      // 6. Remo
      remo: 'https://media.api-sports.io/football/teams/10213.png',
      clubedoremo: 'https://media.api-sports.io/football/teams/10213.png',
    }

    function normalizeKey(str) {
      if (!str) return ''
      var s = String(str).toLowerCase()
      try {
        s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      } catch (_) {}
      return s.replace(/[^a-z0-9]/g, '').trim()
    }

    function getTargetBadge(teamName) {
      var k = normalizeKey(teamName)
      if (!k) return null

      // Proteção explícita para Boca Juniors (NUNCA alterar)
      if (k === 'bocajuniors' || k === 'boca' || k === 'cabocajuniors') {
        return null
      }

      if (TARGET_CLUBS[k]) {
        return TARGET_CLUBS[k]
      }

      // Variações parciais estritas apenas para os 6 times
      if (k.indexOf('estudiantes') !== -1) {
        return TARGET_CLUBS.estudiantes
      }
      if (k.indexOf('chapecoense') !== -1) {
        return TARGET_CLUBS.chapecoense
      }
      if (k.indexOf('coritiba') !== -1) {
        return TARGET_CLUBS.coritiba
      }
      if (k.indexOf('bragantino') !== -1) {
        return TARGET_CLUBS.bragantino
      }
      if (k.indexOf('mirassol') !== -1) {
        return TARGET_CLUBS.mirassol
      }
      if (k === 'remo' || k === 'clubedoremo') {
        return TARGET_CLUBS.remo
      }

      return null
    }

    // Helper para atualizar ficha_detalhes / escalacoes se contiverem dados de teams
    function atualizarFichaOuPayload(dataObj, tA, tB, canonA, canonB) {
      if (!dataObj || typeof dataObj !== 'object') return false
      var modified = false
      var item = Array.isArray(dataObj) ? dataObj[0] : dataObj
      if (item && typeof item === 'object') {
        var teams =
          item.teams ||
          (item.fixture && item.fixture.teams) ||
          (item.response && item.response[0] && item.response[0].teams)
        if (teams) {
          if (canonA && teams.home) {
            teams.home.logo = canonA
            if (teams.home.badge) teams.home.badge = canonA
            modified = true
          }
          if (canonB && teams.away) {
            teams.away.logo = canonB
            if (teams.away.badge) teams.away.badge = canonB
            modified = true
          }
        }
      }
      return modified
    }

    // -------------------------------------------------------------
    // FASE 1: Varredura em 'enquete_jogos'
    // -------------------------------------------------------------
    try {
      var allEJ = app.findRecordsByFilter('enquete_jogos', '', '', 2000, 0)
      var totalEjAtualizados = 0

      for (var i = 0; i < allEJ.length; i++) {
        var ej = allEJ[i]
        var tA = ej.getString('time_a') || ''
        var tB = ej.getString('time_b') || ''
        var logoA = ej.getString('logo_casa') || ''
        var logoB = ej.getString('logo_visitante') || ''
        var changed = false

        var targetA = getTargetBadge(tA)
        if (targetA && logoA !== targetA) {
          ej.set('logo_casa', targetA)
          changed = true
        }

        var targetB = getTargetBadge(tB)
        if (targetB && logoB !== targetB) {
          ej.set('logo_visitante', targetB)
          changed = true
        }

        if (changed) {
          app.save(ej)
          totalEjAtualizados++
        }
      }
      console.log(
        '[migration 0101] enquete_jogos: ' + totalEjAtualizados + ' registros atualizados.',
      )
    } catch (errEJ) {
      console.log('[migration 0101] Erro ao varrer enquete_jogos:', errEJ)
    }

    // -------------------------------------------------------------
    // FASE 2: Varredura em 'jogos'
    // -------------------------------------------------------------
    try {
      var allJ = app.findRecordsByFilter('jogos', '', '', 5000, 0)
      var totalJAtualizados = 0

      for (var j = 0; j < allJ.length; j++) {
        var jg = allJ[j]
        var jA = jg.getString('time_a') || ''
        var jB = jg.getString('time_b') || ''
        var jLogoA = jg.getString('url_escudo_mandante') || ''
        var jLogoB = jg.getString('url_escudo_visitante') || ''
        var jChanged = false

        var jTargetA = getTargetBadge(jA)
        if (jTargetA && jLogoA !== jTargetA) {
          jg.set('url_escudo_mandante', jTargetA)
          jChanged = true
        }

        var jTargetB = getTargetBadge(jB)
        if (jTargetB && jLogoB !== jTargetB) {
          jg.set('url_escudo_visitante', jTargetB)
          jChanged = true
        }

        // Se houver ficha_detalhes com logo desatualizado
        var ficha = jg.get('ficha_detalhes')
        if (ficha) {
          var parsedFicha = ficha
          var parsedFromStr = false
          if (typeof parsedFicha === 'string') {
            try {
              parsedFicha = JSON.parse(parsedFicha)
              parsedFromStr = true
            } catch (_) {}
          }
          if (atualizarFichaOuPayload(parsedFicha, jA, jB, jTargetA, jTargetB)) {
            jg.set('ficha_detalhes', parsedFromStr ? JSON.stringify(parsedFicha) : parsedFicha)
            jChanged = true
          }
        }

        if (jChanged) {
          app.save(jg)
          totalJAtualizados++
        }
      }
      console.log('[migration 0101] jogos: ' + totalJAtualizados + ' registros atualizados.')
    } catch (errJ) {
      console.log('[migration 0101] Erro ao varrer jogos:', errJ)
    }

    // -------------------------------------------------------------
    // FASE 3: Varredura em 'jogos_do_dia' (se houver registros)
    // -------------------------------------------------------------
    try {
      var allJDD = app.findRecordsByFilter('jogos_do_dia', '', '', 2000, 0)
      var totalJddAtualizados = 0

      for (var k = 0; k < allJDD.length; k++) {
        var jdd = allJDD[k]
        var casa = jdd.getString('time_casa') || ''
        var visi = jdd.getString('time_visitante') || ''
        var lCasa = jdd.getString('logo_casa') || ''
        var lVisi = jdd.getString('logo_visitante') || ''
        var jddChanged = false

        var targetCasa = getTargetBadge(casa)
        if (targetCasa && lCasa !== targetCasa) {
          jdd.set('logo_casa', targetCasa)
          jddChanged = true
        }

        var targetVisi = getTargetBadge(visi)
        if (targetVisi && lVisi !== targetVisi) {
          jdd.set('logo_visitante', targetVisi)
          jddChanged = true
        }

        if (jddChanged) {
          app.save(jdd)
          totalJddAtualizados++
        }
      }
      if (totalJddAtualizados > 0) {
        console.log(
          '[migration 0101] jogos_do_dia: ' + totalJddAtualizados + ' registros atualizados.',
        )
      }
    } catch (errJDD) {
      console.log('[migration 0101] Erro ao varrer jogos_do_dia:', errJDD)
    }

    console.log('[migration 0101] Concluída com sucesso!')
  },
  (app) => {},
)
