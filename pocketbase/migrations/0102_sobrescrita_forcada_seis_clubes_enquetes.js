// pocketbase/migrations/0102_sobrescrita_forcada_seis_clubes_enquetes.js
// Sobrescrita incondicional forçada de escudos/logos de APENAS 6 clubes nacionais:
// 1. Coritiba (CFC, Coritiba FBC, Coxa) -> 132 -> https://media.api-sports.io/football/teams/132.png
// 2. Chapecoense (ACF, Chape, Chapecoense AF) -> 147 -> https://media.api-sports.io/football/teams/147.png
// 3. Mirassol (Mirassol FC) -> 10214 -> https://media.api-sports.io/football/teams/10214.png
// 4. Red Bull Bragantino (Bragantino, RB Bragantino) -> 1199 -> https://media.api-sports.io/football/teams/1199.png
// 5. Remo (Clube do Remo) -> 10213 -> https://media.api-sports.io/football/teams/10213.png
// 6. Vitória (EC Vitória, Esporte Clube Vitória) -> 136 -> https://media.api-sports.io/football/teams/136.png
//
// REGRA ABSOLUTA: NÃO mexer em Estudiantes, Boca Juniors, River Plate ou qualquer time internacional.
// Varrer incondicionalmente: 'enquete_jogos', 'jogos' e 'jogos_do_dia'.

migrate(
  (app) => {
    console.log('[migration 0102] Iniciando sobrescrita incondicional dos 6 clubes nacionais...')

    var CANONICAL_6_CLUBS = {
      // 1. Coritiba -> 132
      coritiba: 'https://media.api-sports.io/football/teams/132.png',
      coritibafbc: 'https://media.api-sports.io/football/teams/132.png',
      cfc: 'https://media.api-sports.io/football/teams/132.png',
      coxa: 'https://media.api-sports.io/football/teams/132.png',

      // 2. Chapecoense -> 147
      chapecoense: 'https://media.api-sports.io/football/teams/147.png',
      chapecoenseaf: 'https://media.api-sports.io/football/teams/147.png',
      chape: 'https://media.api-sports.io/football/teams/147.png',
      acf: 'https://media.api-sports.io/football/teams/147.png',

      // 3. Mirassol -> 10214
      mirassol: 'https://media.api-sports.io/football/teams/10214.png',
      mirassolfc: 'https://media.api-sports.io/football/teams/10214.png',

      // 4. Red Bull Bragantino -> 1199
      redbullbragantino: 'https://media.api-sports.io/football/teams/1199.png',
      bragantino: 'https://media.api-sports.io/football/teams/1199.png',
      rbbragantino: 'https://media.api-sports.io/football/teams/1199.png',

      // 5. Remo -> 10213
      remo: 'https://media.api-sports.io/football/teams/10213.png',
      clubedoremo: 'https://media.api-sports.io/football/teams/10213.png',

      // 6. Vitória -> 136
      vitoria: 'https://media.api-sports.io/football/teams/136.png',
      ecvitoria: 'https://media.api-sports.io/football/teams/136.png',
      esporteclubevitoria: 'https://media.api-sports.io/football/teams/136.png',
    }

    function normalizeKey(str) {
      if (!str) return ''
      var s = String(str).toLowerCase()
      try {
        s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      } catch (_) {}
      return s.replace(/[^a-z0-9]/g, '').trim()
    }

    function getCanonicalBadge(teamName) {
      var k = normalizeKey(teamName)
      if (!k) return null

      // Proteções explícitas contra times internacionais (NUNCA alterar)
      if (
        k.indexOf('boca') !== -1 ||
        k.indexOf('river') !== -1 ||
        k.indexOf('estudiantes') !== -1
      ) {
        return null
      }

      // 1. Mapeamento exato
      if (CANONICAL_6_CLUBS[k]) {
        return CANONICAL_6_CLUBS[k]
      }

      // 2. Verificações de sigla ou nome com subcadeias específicas dos 6 clubes
      if (k === 'cfc' || k === 'coxa' || k.indexOf('coritiba') !== -1) {
        return CANONICAL_6_CLUBS.coritiba
      }
      if (k === 'acf' || k === 'chape' || k.indexOf('chapecoense') !== -1) {
        return CANONICAL_6_CLUBS.chapecoense
      }
      if (k.indexOf('mirassol') !== -1) {
        return CANONICAL_6_CLUBS.mirassol
      }
      if (k.indexOf('bragantino') !== -1) {
        return CANONICAL_6_CLUBS.bragantino
      }
      if (k === 'remo' || k === 'clubedoremo') {
        return CANONICAL_6_CLUBS.remo
      }
      if (
        k === 'vitoria' ||
        k === 'ecvitoria' ||
        k === 'esporteclubevitoria' ||
        (k.indexOf('vitoria') !== -1 && k.indexOf('setubal') === -1)
      ) {
        return CANONICAL_6_CLUBS.vitoria
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
            if (teams.home.logo !== canonA || teams.home.badge !== canonA) {
              teams.home.logo = canonA
              teams.home.badge = canonA
              modified = true
            }
          }
          if (canonB && teams.away) {
            if (teams.away.logo !== canonB || teams.away.badge !== canonB) {
              teams.away.logo = canonB
              teams.away.badge = canonB
              modified = true
            }
          }
        }
      }
      return modified
    }

    // -------------------------------------------------------------
    // FASE 1: Varredura incondicional em 'enquete_jogos'
    // -------------------------------------------------------------
    var totalEjAtualizados = 0
    try {
      var allEJ = app.findRecordsByFilter('enquete_jogos', '', '', 5000, 0)

      for (var i = 0; i < allEJ.length; i++) {
        var ej = allEJ[i]
        var tA = ej.getString('time_a') || ''
        var tB = ej.getString('time_b') || ''
        var logoA = ej.getString('logo_casa') || ''
        var logoB = ej.getString('logo_visitante') || ''
        var changed = false

        var targetA = getCanonicalBadge(tA)
        if (targetA && logoA !== targetA) {
          ej.set('logo_casa', targetA)
          changed = true
        }

        var targetB = getCanonicalBadge(tB)
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
        '[migration 0102] enquete_jogos: ' + totalEjAtualizados + ' registros sobrescritos.',
      )
    } catch (errEJ) {
      console.log('[migration 0102] Erro em enquete_jogos:', errEJ)
    }

    // -------------------------------------------------------------
    // FASE 2: Varredura incondicional em 'jogos'
    // -------------------------------------------------------------
    var totalJAtualizados = 0
    try {
      var allJ = app.findRecordsByFilter('jogos', '', '', 10000, 0)

      for (var j = 0; j < allJ.length; j++) {
        var jg = allJ[j]
        var jA = jg.getString('time_a') || ''
        var jB = jg.getString('time_b') || ''
        var jLogoA = jg.getString('url_escudo_mandante') || ''
        var jLogoB = jg.getString('url_escudo_visitante') || ''
        var jChanged = false

        var jTargetA = getCanonicalBadge(jA)
        if (jTargetA && jLogoA !== jTargetA) {
          jg.set('url_escudo_mandante', jTargetA)
          jChanged = true
        }

        var jTargetB = getCanonicalBadge(jB)
        if (jTargetB && jLogoB !== jTargetB) {
          jg.set('url_escudo_visitante', jTargetB)
          jChanged = true
        }

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
      console.log('[migration 0102] jogos: ' + totalJAtualizados + ' registros sobrescritos.')
    } catch (errJ) {
      console.log('[migration 0102] Erro em jogos:', errJ)
    }

    // -------------------------------------------------------------
    // FASE 3: Varredura incondicional em 'jogos_do_dia'
    // -------------------------------------------------------------
    var totalJddAtualizados = 0
    try {
      var allJDD = app.findRecordsByFilter('jogos_do_dia', '', '', 5000, 0)

      for (var k = 0; k < allJDD.length; k++) {
        var jdd = allJDD[k]
        var casa = jdd.getString('time_casa') || ''
        var visi = jdd.getString('time_visitante') || ''
        var lCasa = jdd.getString('logo_casa') || ''
        var lVisi = jdd.getString('logo_visitante') || ''
        var jddChanged = false

        var targetCasa = getCanonicalBadge(casa)
        if (targetCasa && lCasa !== targetCasa) {
          jdd.set('logo_casa', targetCasa)
          jddChanged = true
        }

        var targetVisi = getCanonicalBadge(visi)
        if (targetVisi && lVisi !== targetVisi) {
          jdd.set('logo_visitante', targetVisi)
          jddChanged = true
        }

        if (jddChanged) {
          app.save(jdd)
          totalJddAtualizados++
        }
      }
      console.log(
        '[migration 0102] jogos_do_dia: ' + totalJddAtualizados + ' registros sobrescritos.',
      )
    } catch (errJDD) {
      console.log('[migration 0102] Erro em jogos_do_dia:', errJDD)
    }

    console.log(
      '[migration 0102] Concluída com sucesso! Total sobrescrito: enquete_jogos=' +
        totalEjAtualizados +
        ', jogos=' +
        totalJAtualizados +
        ', jogos_do_dia=' +
        totalJddAtualizados,
    )
  },
  (app) => {},
)
