// pocketbase/migrations/0100_sobrescrita_total_escudos_e_normalizacao_ligas.js
// Sobrescrita TOTAL de escudos no banco em 'jogos' e 'enquete_jogos'
// + Normalização de nomes de competições (ex: "Brazilian Serie A" -> "Brasileirão Série A")

migrate(
  (app) => {
    console.log(
      '[migration 0100] Iniciando sobrescrita total de escudos e normalização de ligas...',
    )

    // 1. Normalizador canônico de ligas / competições
    var LEAGUE_CANONICAL_MAP = {
      'brazilian serie a': 'Brasileirão Série A',
      'brazilian série a': 'Brasileirão Série A',
      'serie a brazil': 'Brasileirão Série A',
      'serie a brasil': 'Brasileirão Série A',
      brasileirao: 'Brasileirão Série A',
      brasileirão: 'Brasileirão Série A',
      'brasileirao serie a': 'Brasileirão Série A',
      'brasileirão serie a': 'Brasileirão Série A',
      'brazilian serie b': 'Brasileirão Série B',
      'brazilian série b': 'Brasileirão Série B',
      'brasileirao serie b': 'Brasileirão Série B',
      'brasileirão serie b': 'Brasileirão Série B',
      'copa libertadores': 'Copa Libertadores',
      'copa conmebol libertadores': 'Copa Libertadores',
      'copa sudamericana': 'Copa Sul-Americana',
      'copa sul-americana': 'Copa Sul-Americana',
      'copa do brasil': 'Copa do Brasil',
      'premier league': 'Premier League',
      'la liga': 'La Liga',
      laliga: 'La Liga',
      'serie a': 'Serie A',
      'serie a tim': 'Serie A',
      bundesliga: 'Bundesliga',
      'ligue 1': 'Ligue 1',
      'champions league': 'Champions League',
      'uefa champions league': 'Champions League',
    }

    function normalizarNomeLiga(nome) {
      if (!nome) return ''
      var clean = String(nome).trim()
      var low = clean.toLowerCase()
      try {
        low = low.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      } catch (_) {}
      low = low.replace(/\s+/g, ' ').trim()

      if (LEAGUE_CANONICAL_MAP[low]) {
        return LEAGUE_CANONICAL_MAP[low]
      }
      if (
        low.indexOf('brazilian serie a') !== -1 ||
        low === 'brasileirao' ||
        low === 'brasileirao serie a'
      ) {
        return 'Brasileirão Série A'
      }
      if (low.indexOf('brazilian serie b') !== -1 || low === 'brasileirao serie b') {
        return 'Brasileirão Série B'
      }
      return clean
    }

    // 2. Dicionário canônico expandido de clubes (media.api-sports.io)
    var CLUB_ID_MAP = {
      // Série A e B Brasil
      botafogo: 120,
      botafogorj: 120,
      botafogofr: 120,
      bfr: 120,
      vasco: 133,
      vascodagama: 133,
      crvascodagama: 133,
      flamengo: 127,
      crflamengo: 127,
      fluminense: 124,
      fluminensefc: 124,
      palmeiras: 121,
      sepalmeiras: 121,
      corinthians: 131,
      sccorinthians: 131,
      corinthianspaulista: 131,
      sccorinthianspaulista: 131,
      sccp: 131,
      saopaulo: 126,
      spfc: 126,
      saopaulofc: 126,
      santos: 128,
      santosfc: 128,
      gremio: 130,
      gremiofbpa: 130,
      internacional: 119,
      inter: 119,
      scinternacional: 119,
      sci: 119,
      atleticomineiro: 1062,
      atleticomg: 1062,
      cam: 1062,
      cruzeiro: 135,
      cruzeiroec: 135,
      bahia: 118,
      ecbahia: 118,
      fortaleza: 154,
      fortalezaec: 154,
      athleticopr: 134,
      athleticoparanaense: 134,
      athletico: 134,
      atleticopr: 134,
      atleticoparanaense: 134,
      coritiba: 132,
      coritibafbc: 132,
      cfc: 132,
      coxa: 132,
      chapecoense: 147,
      chapecoenseaf: 147,
      chape: 147,
      acf: 147,
      vitoria: 136,
      ecvitoria: 136,
      esporteclubevitoria: 136,
      criciuma: 140,
      criciumaec: 140,
      cuiaba: 1200,
      cuiabaec: 1200,
      juventude: 152,
      ecjuventude: 152,
      redbullbragantino: 1199,
      bragantino: 1199,
      rbbragantino: 1199,
      mirassol: 10214,
      mirassolfc: 10214,
      remo: 10213,
      clubedoremo: 10213,
      goias: 144,
      goiasec: 144,
      sport: 794,
      sportrecife: 794,
      ceara: 129,
      cearasc: 129,
      avai: 138,
      avaifc: 138,
      pontepreta: 148,
      pontepretafc: 148,
      novorizontino: 10215,
      gremionovorizontino: 10215,
      vilanova: 141,
      vilanovaec: 141,
      operario: 143,
      operariopr: 143,
      operarioferroviario: 143,
      amazonas: 18561,
      amazonasfc: 18561,
      paysandu: 149,
      paysandusc: 149,
      brusque: 10216,
      brusquefc: 10216,
      ituano: 145,
      ituanofc: 145,
      guarani: 146,
      guaranifc: 146,
      botafogosp: 142,
      crb: 150,
      crbal: 150,
      americamg: 137,
      americamineiro: 137,
      londrina: 139,
      londrinaec: 139,
      nautico: 151,
      nauticope: 151,
      figueirense: 153,
      figueirensefc: 153,
      csa: 155,
      csaal: 155,
      sampaiocorrea: 156,
      confianca: 157,
      adconfianca: 157,
      brasildepelotas: 158,
      oeste: 159,
      oestefc: 159,
      ferroviaria: 10218,
      athleticclub: 18560,
      voltaredonda: 10217,
      saobernardo: 10219,
      saobernardofc: 10219,
      botafogopb: 10220,
      ypiranga: 10221,
      ypirangars: 10221,
      aparecidense: 10222,
      tombense: 10223,
      tombensefc: 10223,
      ferroviario: 10224,
      abc: 10225,
      abcfc: 10225,
      caxias: 10226,
      sercaxias: 10226,

      // Sul-Americana & Libertadores (CONMEBOL)
      bocajuniors: 451,
      boca: 451,
      riverplate: 435,
      river: 435,
      estudiantes: 450,
      estudiantesdelaplata: 450,
      estudanteslp: 450,
      montevideocitytorque: 2365,
      montevideocity: 2365,
      torque: 2365,
      atleticotorque: 2365,
      penarol: 2348,
      nacional: 2356,
      nacionalmontevideo: 2347,
      clubnacional: 2356,
      racingclub: 436,
      racing: 436,
      independiente: 453,
      caindependiente: 453,
      sanlorenzo: 460,
      velez: 438,
      velezsarsfield: 438,
      lanus: 446,
      rosariocentral: 437,
      newells: 455,
      newellsoldboys: 455,
      olimpia: 1182,
      clubolimpia: 1182,
      cerroporteno: 1176,
      libertad: 1179,
      libertadasuncion: 1179,
      ldu: 1158,
      lduquito: 1158,
      ldudequito: 1158,
      universidadcentral: 3710,
      ucv: 3710,
      ucvfc: 3710,
      independientemedellin: 1137,
      indepmedellin: 1137,
      dim: 1137,
      independienterivadavia: 440,
      independientesantafe: 1138,
      santafe: 1138,
      macara: 1162,
      cdmacara: 1162,
      platense: 448,
      caplatense: 448,
      cienciano: 2548,
      clubcienciano: 2548,
      independientedelvalle: 1153,
      barcelonasc: 1152,
      barcelonadeguayaquil: 1152,
      colocolo: 2315,
      universidaddechile: 2314,
      udechile: 2314,
      universidadcatolica: 2994,
      ucatolica: 2994,
      bolivar: 3702,
      thestrongest: 3703,
      sportingcristal: 2546,
      alianzalima: 2541,
      universitario: 2540,
      universitariodedeportes: 2540,

      // Europa / Mundiais
      psg: 85,
      parissaintgermain: 85,
      realmadrid: 541,
      barcelona: 529,
      fcbarcelona: 529,
      atleticodemadrid: 530,
      atleticomadrid: 530,
      manchestercity: 50,
      manchesterunited: 33,
      liverpool: 40,
      arsenal: 42,
      chelsea: 49,
      tottenham: 47,
      newcastle: 34,
      newcastleunited: 34,
      fulham: 36,
      fulhamfc: 36,
      lens: 116,
      rclens: 116,
      bayernmunique: 157,
      bayernmunich: 157,
      bayernmunchen: 157,
      borussiadortmund: 165,
      juventus: 496,
      milan: 489,
      acmilan: 489,
      interdemilao: 505,
      intermilan: 505,
      roma: 497,
      asroma: 497,
      napoli: 492,
      benfica: 211,
      slbenfica: 211,
      porto: 212,
      fcporto: 212,
      sporting: 228,
      sportingcp: 228,
      ajax: 194,
      alhilal: 2939,
      alnassr: 2938,
      intermiami: 8983,
    }

    // 3. Bandeiras oficiais de seleções (FlagCDN)
    var SELECAO_FLAG_MAP = {
      brasil: 'br',
      brazil: 'br',
      argentina: 'ar',
      alemanha: 'de',
      germany: 'de',
      deutschland: 'de',
      holanda: 'nl',
      paisesbaixos: 'nl',
      netherlands: 'nl',
      estadosunidos: 'us',
      usa: 'us',
      eua: 'us',
      mexico: 'mx',
      canada: 'ca',
      colombia: 'co',
      chile: 'cl',
      peru: 'pe',
      equador: 'ec',
      ecuador: 'ec',
      paraguai: 'py',
      paraguay: 'py',
      venezuela: 've',
      bolivia: 'bo',
      catar: 'qa',
      qatar: 'qa',
      marrocos: 'ma',
      morocco: 'ma',
      senegal: 'sn',
      gana: 'gh',
      ghana: 'gh',
      nigeria: 'ng',
      camaroes: 'cm',
      cameroon: 'cm',
      coreiadosul: 'kr',
      southkorea: 'kr',
      coreiadonorte: 'kp',
      arabiasaudita: 'sa',
      saudiarabia: 'sa',
      ira: 'ir',
      iran: 'ir',
      australia: 'au',
      suica: 'ch',
      switzerland: 'ch',
      suecia: 'se',
      sweden: 'se',
      polonia: 'pl',
      poland: 'pl',
      servia: 'rs',
      serbia: 'rs',
      ucrania: 'ua',
      ukraine: 'ua',
      austria: 'at',
      hungria: 'hu',
      hungary: 'hu',
      eslovenia: 'si',
      slovenia: 'si',
      eslovaquia: 'sk',
      slovakia: 'sk',
      romenia: 'ro',
      romania: 'ro',
      albania: 'al',
      costarica: 'cr',
      panama: 'pa',
      guatemala: 'gt',
      trinidadetobago: 'tt',
      trinidadandtobago: 'tt',
      haiti: 'ht',
      cuba: 'cu',
      curacao: 'cw',
      curacau: 'cw',
      suriname: 'sr',
      guiana: 'gy',
      guyana: 'gy',
      emiradosarabesunidos: 'ae',
      emiradosarabes: 'ae',
      uae: 'ae',
      bahrein: 'bh',
      bahrain: 'bh',
      iemen: 'ye',
      yemen: 'ye',
      oma: 'om',
      oman: 'om',
      kuwait: 'kw',
      iraque: 'iq',
      iraq: 'iq',
      jordania: 'jo',
      jordan: 'jo',
      egito: 'eg',
      egypt: 'eg',
      argelia: 'dz',
      algeria: 'dz',
      tunisia: 'tn',
      africadosul: 'za',
      southafrica: 'za',
      costadomarfim: 'ci',
      ivorycoast: 'ci',
      grecia: 'gr',
      greece: 'gr',
      irlanda: 'ie',
      ireland: 'ie',
      republicofireland: 'ie',
      finlandia: 'fi',
      finland: 'fi',
      islandia: 'is',
      iceland: 'is',
      tchequia: 'cz',
      czechia: 'cz',
      czechrepublic: 'cz',
      republicatcheca: 'cz',
      croacia: 'hr',
      croatia: 'hr',
      georgia: 'ge',
      irlandadonorte: 'gb-nir',
      northernireland: 'gb-nir',
      italia: 'it',
      italy: 'it',
      belgica: 'be',
      belgium: 'be',
      turquia: 'tr',
      turkey: 'tr',
      turkiye: 'tr',
      franca: 'fr',
      france: 'fr',
      portugal: 'pt',
      dinamarca: 'dk',
      denmark: 'dk',
      noruega: 'no',
      norway: 'no',
      inglaterra: 'gb-eng',
      england: 'gb-eng',
      espanha: 'es',
      spain: 'es',
      escocia: 'gb-sct',
      scotland: 'gb-sct',
      alba: 'gb-sct',
      paisdegales: 'gb-wls',
      gales: 'gb-wls',
      wales: 'gb-wls',
      cymru: 'gb-wls',
      japao: 'jp',
      japan: 'jp',
      uruguai: 'uy',
      uruguay: 'uy',
      letonia: 'lv',
      latvia: 'lv',
      chipre: 'cy',
      cyprus: 'cy',
      armenia: 'am',
      montenegro: 'me',
      zimbabue: 'zw',
      zimbabwe: 'zw',
      republicademocraticadocongo: 'cd',
      drcongo: 'cd',
      rdcongo: 'cd',
      congodemocratico: 'cd',
      republicadocongo: 'cg',
      congo: 'cg',
      congobrazzaville: 'cg',
      guineequatorial: 'gq',
      equatorialguinea: 'gq',
      serraleoa: 'sl',
      sierraleone: 'sl',
      republicacentroafricana: 'cf',
      centroafricana: 'cf',
      burkinafaso: 'bf',
      lituania: 'lt',
      lithuania: 'lt',
      azerbaijao: 'az',
      azerbaijan: 'az',
      novazelandia: 'nz',
      newzealand: 'nz',
      bosniaeherzegovina: 'ba',
      bosnia: 'ba',
      caboverde: 'cv',
      uzbequistao: 'uz',
      uzbekistan: 'uz',
    }

    function normalizeNameKey(str) {
      if (!str) return ''
      var s = String(str).toLowerCase()
      try {
        s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      } catch (_) {}
      return s.replace(/[^a-z0-9]/g, '').trim()
    }

    function resolverEscudoPorNome(teamName) {
      var k = normalizeNameKey(teamName)
      if (!k) return ''
      if (CLUB_ID_MAP[k]) {
        return 'https://media.api-sports.io/football/teams/' + CLUB_ID_MAP[k] + '.png'
      }
      if (SELECAO_FLAG_MAP[k]) {
        return 'https://flagcdn.com/w80/' + SELECAO_FLAG_MAP[k] + '.png'
      }
      return ''
    }

    function isUrlIncorretaOuVazia(teamName, url) {
      if (!url || !url.trim()) return true
      var u = url.trim().toLowerCase()
      if (u.indexOf('thesportsdb.com') !== -1) return true
      if (u.indexOf('z3v04x') !== -1 || u.indexOf('bsc') !== -1) return true

      var k = normalizeNameKey(teamName)
      if (
        (k === 'redbullbragantino' || k === 'bragantino' || k === 'rbbragantino') &&
        u.indexOf('/130.') !== -1
      )
        return true
      if (k === 'remo' && u.indexOf('/121.') !== -1) return true
      if (
        (k === 'chapecoense' || k === 'chapecoenseaf' || k === 'chape' || k === 'acf') &&
        u.indexOf('/132.') !== -1
      )
        return true
      if (
        (k === 'coritiba' || k === 'coritibafbc' || k === 'coxa' || k === 'cfc') &&
        u.indexOf('/147.') !== -1
      )
        return true
      if (k === 'cruzeiro' && u.indexOf('/132.') !== -1) return true
      if ((k === 'vitoria' || k === 'ecvitoria') && u.indexOf('/140.') !== -1) return true
      return false
    }

    // Helper: Extrai fixture details se existir
    function extrairLogosFicha(ficha) {
      if (!ficha) return null
      var data = ficha
      while (typeof data === 'string') {
        var tr = data.trim()
        if (!tr) return null
        try {
          data = JSON.parse(tr)
        } catch (_) {
          return null
        }
      }
      if (!data || typeof data !== 'object') return null
      var item = Array.isArray(data) ? data[0] : data
      if (!item || typeof item !== 'object') return null
      var teams =
        item.teams ||
        (item.fixture && item.fixture.teams) ||
        (item.response && item.response[0] && item.response[0].teams)
      if (teams) {
        var h = (teams.home && (teams.home.logo || teams.home.badge)) || ''
        var a = (teams.away && (teams.away.logo || teams.away.badge)) || ''
        if (h || a) return { home: h, away: a }
      }
      return null
    }

    // -------------------------------------------------------------
    // FASE A: Varredura em 'enquete_jogos'
    // -------------------------------------------------------------
    try {
      var allEJ = app.findRecordsByFilter('enquete_jogos', '', '', 1500, 0)
      var totalEjEscudos = 0
      var totalEjLigas = 0

      for (var i = 0; i < allEJ.length; i++) {
        var ej = allEJ[i]
        var tA = ej.getString('time_a') || ''
        var tB = ej.getString('time_b') || ''
        var logoA = ej.getString('logo_casa') || ''
        var logoB = ej.getString('logo_visitante') || ''
        var camp = ej.getString('campeonato') || ''
        var changed = false

        // 1. Normalização de Liga
        var normCamp = normalizarNomeLiga(camp)
        if (normCamp && normCamp !== camp) {
          ej.set('campeonato', normCamp)
          changed = true
          totalEjLigas++
        }

        // 2. Resolução de Escudos
        var canonA = resolverEscudoPorNome(tA)
        var canonB = resolverEscudoPorNome(tB)

        // Se tem escudo canônico, ele tem precedência absoluta
        if (canonA && (isUrlIncorretaOuVazia(tA, logoA) || logoA !== canonA)) {
          ej.set('logo_casa', canonA)
          changed = true
        } else if (isUrlIncorretaOuVazia(tA, logoA)) {
          if (canonA) {
            ej.set('logo_casa', canonA)
            changed = true
          }
        }

        if (canonB && (isUrlIncorretaOuVazia(tB, logoB) || logoB !== canonB)) {
          ej.set('logo_visitante', canonB)
          changed = true
        } else if (isUrlIncorretaOuVazia(tB, logoB)) {
          if (canonB) {
            ej.set('logo_visitante', canonB)
            changed = true
          }
        }

        if (changed) {
          app.save(ej)
          totalEjEscudos++
        }
      }
      console.log(
        '[migration 0100] enquete_jogos processados: ' +
          totalEjEscudos +
          ' registros atualizados (ligas corrigidas: ' +
          totalEjLigas +
          ')',
      )
    } catch (errEJ) {
      console.log('[migration 0100] Erro ao varrer enquete_jogos:', errEJ)
    }

    // -------------------------------------------------------------
    // FASE B: Varredura em 'jogos'
    // -------------------------------------------------------------
    try {
      var allJ = app.findRecordsByFilter('jogos', '', '', 3000, 0)
      var totalJEscudos = 0
      var totalJLigas = 0

      for (var j = 0; j < allJ.length; j++) {
        var jg = allJ[j]
        var jA = jg.getString('time_a') || ''
        var jB = jg.getString('time_b') || ''
        var jLogoA = jg.getString('url_escudo_mandante') || ''
        var jLogoB = jg.getString('url_escudo_visitante') || ''
        var jComp = jg.getString('competicao') || ''
        var jFicha = jg.get('ficha_detalhes')
        var jChanged = false

        // 1. Normalização de Liga
        var normJComp = normalizarNomeLiga(jComp)
        if (normJComp && normJComp !== jComp) {
          jg.set('competicao', normJComp)
          jChanged = true
          totalJLigas++
        }

        // 2. Resolução de Escudos
        // Nível 0: Dicionário canônico
        var jCanonA = resolverEscudoPorNome(jA)
        var jCanonB = resolverEscudoPorNome(jB)

        // Se tiver ficha_detalhes, pode servir de fallback
        var fichaLogos = extrairLogosFicha(jFicha)

        // Mandante
        if (jCanonA && (isUrlIncorretaOuVazia(jA, jLogoA) || jLogoA !== jCanonA)) {
          jg.set('url_escudo_mandante', jCanonA)
          jChanged = true
        } else if (isUrlIncorretaOuVazia(jA, jLogoA)) {
          if (jCanonA) {
            jg.set('url_escudo_mandante', jCanonA)
            jChanged = true
          } else if (fichaLogos && fichaLogos.home && !isUrlIncorretaOuVazia(jA, fichaLogos.home)) {
            jg.set('url_escudo_mandante', fichaLogos.home)
            jChanged = true
          }
        }

        // Visitante
        if (jCanonB && (isUrlIncorretaOuVazia(jB, jLogoB) || jLogoB !== jCanonB)) {
          jg.set('url_escudo_visitante', jCanonB)
          jChanged = true
        } else if (isUrlIncorretaOuVazia(jB, jLogoB)) {
          if (jCanonB) {
            jg.set('url_escudo_visitante', jCanonB)
            jChanged = true
          } else if (fichaLogos && fichaLogos.away && !isUrlIncorretaOuVazia(jB, fichaLogos.away)) {
            jg.set('url_escudo_visitante', fichaLogos.away)
            jChanged = true
          }
        }

        if (jChanged) {
          app.save(jg)
          totalJEscudos++
        }
      }
      console.log(
        '[migration 0100] jogos processados: ' +
          totalJEscudos +
          ' registros atualizados (ligas corrigidas: ' +
          totalJLigas +
          ')',
      )
    } catch (errJ) {
      console.log('[migration 0100] Erro ao varrer jogos:', errJ)
    }

    console.log('[migration 0100] Concluído com sucesso.')
  },
  (app) => {},
)
