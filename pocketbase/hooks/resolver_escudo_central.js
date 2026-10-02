// pocketbase/hooks/resolver_escudo_central.js
// Centralizador Sistêmico de Resolução de Escudos / Brasões / Bandeiras
// Atende Enquetes e Admin de Jogos tanto no backend quanto em chamadas REST
// Ordem de resolução:
// 1. Dicionário canônico (Série A, clubes brasileiros e internacionais)
// 2. Fixture ID na API-Football (/fixtures?id=...)
// 3. Busca na API-Football por nome exato (/teams?search=...)
// 4. Bandeira oficial de seleções via FlagCDN (https://flagcdn.com/w80/{iso}.png)
// PROIBIDO: TheSportsDB e correspondências por siglas curtas (2-3 letras)

// -------------------------------------------------------------
// Endpoint REST para resolução antecipada pelo Frontend
// POST /backend/v1/resolver-escudos
// Payload: { time_a, time_b, fixture_id, logo_a?, logo_b? }
// -------------------------------------------------------------
routerAdd(
  'POST',
  '/backend/v1/resolver-escudos',
  (e) => {
    var CANONICAL_CLUB_MAP = {
      redbullbragantino: 'https://media.api-sports.io/football/teams/1199.png',
      rbbragantino: 'https://media.api-sports.io/football/teams/1199.png',
      bragantino: 'https://media.api-sports.io/football/teams/1199.png',
      mirassol: 'https://media.api-sports.io/football/teams/10214.png',
      mirassolfc: 'https://media.api-sports.io/football/teams/10214.png',
      remo: 'https://media.api-sports.io/football/teams/10213.png',
      clubedoremo: 'https://media.api-sports.io/football/teams/10213.png',
      gremio: 'https://media.api-sports.io/football/teams/130.png',
      gremiofbpa: 'https://media.api-sports.io/football/teams/130.png',
      chapecoense: 'https://media.api-sports.io/football/teams/147.png',
      chapecoenseaf: 'https://media.api-sports.io/football/teams/147.png',
      chape: 'https://media.api-sports.io/football/teams/147.png',
      acf: 'https://media.api-sports.io/football/teams/147.png',
      coritiba: 'https://media.api-sports.io/football/teams/132.png',
      coritibafbc: 'https://media.api-sports.io/football/teams/132.png',
      coxa: 'https://media.api-sports.io/football/teams/132.png',
      cfc: 'https://media.api-sports.io/football/teams/132.png',
      vitoria: 'https://media.api-sports.io/football/teams/136.png',
      ecvitoria: 'https://media.api-sports.io/football/teams/136.png',
      botafogo: 'https://media.api-sports.io/football/teams/120.png',
      botafogorj: 'https://media.api-sports.io/football/teams/120.png',
      bfr: 'https://media.api-sports.io/football/teams/120.png',
      vasco: 'https://media.api-sports.io/football/teams/133.png',
      vascodagama: 'https://media.api-sports.io/football/teams/133.png',
      crvascodagama: 'https://media.api-sports.io/football/teams/133.png',
      cruzeiro: 'https://media.api-sports.io/football/teams/135.png',
      cruzeiroec: 'https://media.api-sports.io/football/teams/135.png',
      saopaulo: 'https://media.api-sports.io/football/teams/126.png',
      spfc: 'https://media.api-sports.io/football/teams/126.png',
      santos: 'https://media.api-sports.io/football/teams/128.png',
      santosfc: 'https://media.api-sports.io/football/teams/128.png',
      fluminense: 'https://media.api-sports.io/football/teams/124.png',
      fluminensefc: 'https://media.api-sports.io/football/teams/124.png',
      flamengo: 'https://media.api-sports.io/football/teams/127.png',
      crflamengo: 'https://media.api-sports.io/football/teams/127.png',
      palmeiras: 'https://media.api-sports.io/football/teams/121.png',
      sepalmeiras: 'https://media.api-sports.io/football/teams/121.png',
      bahia: 'https://media.api-sports.io/football/teams/118.png',
      ecbahia: 'https://media.api-sports.io/football/teams/118.png',
      athleticopr: 'https://media.api-sports.io/football/teams/134.png',
      athletico: 'https://media.api-sports.io/football/teams/134.png',
      athleticoparanaense: 'https://media.api-sports.io/football/teams/134.png',
      atleticopr: 'https://media.api-sports.io/football/teams/134.png',
      atleticomineiro: 'https://media.api-sports.io/football/teams/1062.png',
      atleticomg: 'https://media.api-sports.io/football/teams/1062.png',
      cam: 'https://media.api-sports.io/football/teams/1062.png',
      internacional: 'https://media.api-sports.io/football/teams/119.png',
      inter: 'https://media.api-sports.io/football/teams/119.png',
      sci: 'https://media.api-sports.io/football/teams/119.png',
      corinthians: 'https://media.api-sports.io/football/teams/131.png',
      sccorinthianspaulista: 'https://media.api-sports.io/football/teams/131.png',
      sccp: 'https://media.api-sports.io/football/teams/131.png',
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

    var CANONICAL_SELECOES_FLAGS = {
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

    var normalizeKey = function (str) {
      if (!str) return ''
      var s = String(str).toLowerCase().trim()
      try {
        s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      } catch (_) {}
      return s.replace(/[^a-z0-9]/g, '').trim()
    }

    var resolverEscudoCanonico = function (teamName) {
      var k = normalizeKey(teamName)
      if (!k) return ''
      if (CANONICAL_CLUB_MAP[k]) return CANONICAL_CLUB_MAP[k]
      if (CANONICAL_SELECOES_FLAGS[k]) return CANONICAL_SELECOES_FLAGS[k]
      return ''
    }

    var isUrlIncorretaParaTime = function (teamName, url) {
      if (!url) return true
      if (url.indexOf('thesportsdb.com') !== -1) return true
      var k = normalizeKey(teamName)
      if (
        (k === 'redbullbragantino' || k === 'bragantino' || k === 'rbbragantino') &&
        url.indexOf('/130.') !== -1
      )
        return true
      if (k === 'remo' && url.indexOf('/121.') !== -1) return true
      if (
        (k === 'chapecoense' || k === 'chapecoenseaf' || k === 'chape' || k === 'acf') &&
        url.indexOf('/132.') !== -1
      )
        return true
      if (
        (k === 'coritiba' || k === 'coritibafbc' || k === 'coxa' || k === 'cfc') &&
        url.indexOf('/147.') !== -1
      )
        return true
      if (k === 'cruzeiro' && url.indexOf('/132.') !== -1) return true
      if ((k === 'vitoria' || k === 'ecvitoria') && url.indexOf('/140.') !== -1) return true
      if (url.indexOf('z3v04x') !== -1 || url.indexOf('bsc') !== -1) return true
      return false
    }

    var normalizeClubText = function (str) {
      if (!str) return ''
      var s = String(str).toLowerCase().trim()
      try {
        s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      } catch (_) {}
      s = s.replace(/[^a-z0-9\s]/g, ' ')
      var tokens = s.split(/\s+/).filter(Boolean)
      var noise = [
        'afc',
        'fc',
        'sc',
        'cf',
        'cd',
        'sd',
        'clube',
        'club',
        'ec',
        'cr',
        'se',
        'de',
        'do',
        'da',
        'dos',
        'das',
        'del',
        'futebol',
        'futbol',
        'sport',
      ]
      var clean = tokens.filter(function (t) {
        return noise.indexOf(t) === -1
      })
      return clean.length > 0 ? clean.join(' ').trim() : tokens.join(' ').trim()
    }

    var buscarLogoPorNomeApiFootball = function (teamName) {
      if (!teamName) return ''
      try {
        var limiterMod = null
        try {
          limiterMod = require('./api_football_limiter.js')
        } catch (_) {}

        var cleanQuery = normalizeClubText(teamName)
        if (!cleanQuery || cleanQuery.length < 3) return ''

        var url = 'https://v3.football.api-sports.io/teams?search=' + encodeURIComponent(cleanQuery)
        var resp = null

        if (limiterMod && typeof limiterMod.enviarRequisicaoApiFootball === 'function') {
          resp = limiterMod.enviarRequisicaoApiFootball(url, { timeout: 8 }, 2)
        }

        if (
          resp &&
          resp.statusCode === 200 &&
          resp.json &&
          Array.isArray(resp.json.response) &&
          resp.json.response.length > 0
        ) {
          var normTarget = normalizeKey(cleanQuery)
          for (var i = 0; i < resp.json.response.length; i++) {
            var teamObj = resp.json.response[i] && resp.json.response[i].team
            if (!teamObj || !teamObj.logo) continue
            var candidateNorm = normalizeKey(teamObj.name)
            if (
              candidateNorm === normTarget ||
              candidateNorm.indexOf(normTarget) !== -1 ||
              normTarget.indexOf(candidateNorm) !== -1
            ) {
              if (!isUrlIncorretaParaTime(teamName, teamObj.logo)) {
                return teamObj.logo
              }
            }
          }
        }
      } catch (errApi) {
        console.log('[resolver_escudo] Erro na busca por nome API-Football:', errApi)
      }
      return ''
    }

    var buscarLogosPorFixtureIdApiFootball = function (fixtureId) {
      if (!fixtureId || !/^\d+$/.test(String(fixtureId).trim())) {
        return { logoA: '', logoB: '' }
      }
      try {
        var limiterMod = null
        try {
          limiterMod = require('./api_football_limiter.js')
        } catch (_) {}

        var cleanId = String(fixtureId).trim()
        var url = 'https://v3.football.api-sports.io/fixtures?id=' + encodeURIComponent(cleanId)
        var resp = null

        if (limiterMod && typeof limiterMod.enviarRequisicaoApiFootball === 'function') {
          resp = limiterMod.enviarRequisicaoApiFootball(url, { timeout: 10 }, 2)
        }

        if (
          resp &&
          resp.statusCode === 200 &&
          resp.json &&
          Array.isArray(resp.json.response) &&
          resp.json.response.length > 0
        ) {
          var fixItem = resp.json.response[0]
          var lA = (fixItem.teams && fixItem.teams.home && fixItem.teams.home.logo) || ''
          var lB = (fixItem.teams && fixItem.teams.away && fixItem.teams.away.logo) || ''
          return { logoA: lA, logoB: lB }
        }
      } catch (errFix) {
        console.log('[resolver_escudo] Erro na busca por fixture ID:', errFix)
      }
      return { logoA: '', logoB: '' }
    }

    try {
      var body = $apis.requestInfo(e).data || {}
      var tA = (body.time_a || '').trim()
      var tB = (body.time_b || '').trim()
      var fId = (body.fixture_id || '').trim()
      var lA = (body.logo_a || body.logo_casa || body.url_escudo_mandante || '').trim()
      var lB = (body.logo_b || body.logo_visitante || body.url_escudo_visitante || '').trim()

      if (isUrlIncorretaParaTime(tA, lA)) lA = ''
      if (isUrlIncorretaParaTime(tB, lB)) lB = ''

      var canonA = resolverEscudoCanonico(tA)
      var canonB = resolverEscudoCanonico(tB)

      if (canonA) lA = canonA
      if (canonB) lB = canonB

      if ((!lA || !lB) && fId && /^\d+$/.test(String(fId).trim())) {
        var fixLogos = buscarLogosPorFixtureIdApiFootball(fId)
        if (!lA && fixLogos.logoA && !isUrlIncorretaParaTime(tA, fixLogos.logoA)) {
          lA = fixLogos.logoA
        }
        if (!lB && fixLogos.logoB && !isUrlIncorretaParaTime(tB, fixLogos.logoB)) {
          lB = fixLogos.logoB
        }
      }

      if (!lA && tA) {
        var sA = buscarLogoPorNomeApiFootball(tA)
        if (sA) lA = sA
      }
      if (!lB && tB) {
        var sB = buscarLogoPorNomeApiFootball(tB)
        if (sB) lB = sB
      }

      if (!lA && canonA) lA = canonA
      if (!lB && canonB) lB = canonB

      return e.json(200, {
        success: true,
        time_a: tA,
        time_b: tB,
        fixture_id: fId,
        logo_casa: lA,
        logo_visitante: lB,
        url_escudo_mandante: lA,
        url_escudo_visitante: lB,
      })
    } catch (errRes) {
      console.log('[resolver_escudo] Erro no endpoint /backend/v1/resolver-escudos:', errRes)
      return e.json(500, {
        success: false,
        error: errRes ? errRes.message : 'Falha na resolução de escudos',
      })
    }
  },
  $apis.requireAuth(),
)

// -------------------------------------------------------------
// Hooks onRecordCreate & onRecordUpdate:
// GARANTIA NO BANCO: Nenhum jogo em enquete_jogos ou jogos é salvo
// com escudo vazio ou errado se for resolúvel!
// -------------------------------------------------------------

onRecordCreate((e) => {
  var rec = e.record
  try {
    var CANONICAL_MAP = {
      redbullbragantino: 'https://media.api-sports.io/football/teams/1199.png',
      rbbragantino: 'https://media.api-sports.io/football/teams/1199.png',
      bragantino: 'https://media.api-sports.io/football/teams/1199.png',
      mirassol: 'https://media.api-sports.io/football/teams/10214.png',
      mirassolfc: 'https://media.api-sports.io/football/teams/10214.png',
      remo: 'https://media.api-sports.io/football/teams/10213.png',
      clubedoremo: 'https://media.api-sports.io/football/teams/10213.png',
      gremio: 'https://media.api-sports.io/football/teams/130.png',
      gremiofbpa: 'https://media.api-sports.io/football/teams/130.png',
      chapecoense: 'https://media.api-sports.io/football/teams/147.png',
      chapecoenseaf: 'https://media.api-sports.io/football/teams/147.png',
      chape: 'https://media.api-sports.io/football/teams/147.png',
      acf: 'https://media.api-sports.io/football/teams/147.png',
      coritiba: 'https://media.api-sports.io/football/teams/132.png',
      coritibafbc: 'https://media.api-sports.io/football/teams/132.png',
      coxa: 'https://media.api-sports.io/football/teams/132.png',
      cfc: 'https://media.api-sports.io/football/teams/132.png',
      vitoria: 'https://media.api-sports.io/football/teams/136.png',
      ecvitoria: 'https://media.api-sports.io/football/teams/136.png',
      botafogo: 'https://media.api-sports.io/football/teams/120.png',
      botafogorj: 'https://media.api-sports.io/football/teams/120.png',
      bfr: 'https://media.api-sports.io/football/teams/120.png',
      vasco: 'https://media.api-sports.io/football/teams/133.png',
      vascodagama: 'https://media.api-sports.io/football/teams/133.png',
      crvascodagama: 'https://media.api-sports.io/football/teams/133.png',
      cruzeiro: 'https://media.api-sports.io/football/teams/135.png',
      cruzeiroec: 'https://media.api-sports.io/football/teams/135.png',
      saopaulo: 'https://media.api-sports.io/football/teams/126.png',
      spfc: 'https://media.api-sports.io/football/teams/126.png',
      santos: 'https://media.api-sports.io/football/teams/128.png',
      santosfc: 'https://media.api-sports.io/football/teams/128.png',
      fluminense: 'https://media.api-sports.io/football/teams/124.png',
      fluminensefc: 'https://media.api-sports.io/football/teams/124.png',
      flamengo: 'https://media.api-sports.io/football/teams/127.png',
      crflamengo: 'https://media.api-sports.io/football/teams/127.png',
      palmeiras: 'https://media.api-sports.io/football/teams/121.png',
      sepalmeiras: 'https://media.api-sports.io/football/teams/121.png',
      bahia: 'https://media.api-sports.io/football/teams/118.png',
      ecbahia: 'https://media.api-sports.io/football/teams/118.png',
      athleticopr: 'https://media.api-sports.io/football/teams/134.png',
      athletico: 'https://media.api-sports.io/football/teams/134.png',
      athleticoparanaense: 'https://media.api-sports.io/football/teams/134.png',
      atleticopr: 'https://media.api-sports.io/football/teams/134.png',
      atleticomineiro: 'https://media.api-sports.io/football/teams/1062.png',
      atleticomg: 'https://media.api-sports.io/football/teams/1062.png',
      cam: 'https://media.api-sports.io/football/teams/1062.png',
      internacional: 'https://media.api-sports.io/football/teams/119.png',
      inter: 'https://media.api-sports.io/football/teams/119.png',
      sci: 'https://media.api-sports.io/football/teams/119.png',
      corinthians: 'https://media.api-sports.io/football/teams/131.png',
      sccorinthianspaulista: 'https://media.api-sports.io/football/teams/131.png',
      sccp: 'https://media.api-sports.io/football/teams/131.png',
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
      psg: 'https://media.api-sports.io/football/teams/85.png',
      parissaintgermain: 'https://media.api-sports.io/football/teams/85.png',
      realmadrid: 'https://media.api-sports.io/football/teams/541.png',
      barcelona: 'https://media.api-sports.io/football/teams/529.png',
      manchestercity: 'https://media.api-sports.io/football/teams/50.png',
      liverpool: 'https://media.api-sports.io/football/teams/40.png',
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
      dinamarca: 'https://flagcdn.com/w80/dk.png',
      denmark: 'https://flagcdn.com/w80/dk.png',
    }

    var cleanK = function (s) {
      if (!s) return ''
      var str = String(s).toLowerCase().trim()
      try {
        str = str.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      } catch (_) {}
      return str.replace(/[^a-z0-9]/g, '').trim()
    }

    var tA = rec.getString('time_a') || ''
    var tB = rec.getString('time_b') || ''
    var lA = rec.getString('logo_casa') || ''
    var lB = rec.getString('logo_visitante') || ''

    var kA = cleanK(tA)
    var kB = cleanK(tB)

    if (CANONICAL_MAP[kA]) {
      rec.set('logo_casa', CANONICAL_MAP[kA])
    }
    if (CANONICAL_MAP[kB]) {
      rec.set('logo_visitante', CANONICAL_MAP[kB])
    }
  } catch (errHook) {
    console.log('[resolver_escudo hook enquete_jogos create] Aviso:', errHook)
  }
  e.next()
}, 'enquete_jogos')

onRecordUpdate((e) => {
  var rec = e.record
  try {
    var CANONICAL_MAP = {
      redbullbragantino: 'https://media.api-sports.io/football/teams/1199.png',
      rbbragantino: 'https://media.api-sports.io/football/teams/1199.png',
      bragantino: 'https://media.api-sports.io/football/teams/1199.png',
      mirassol: 'https://media.api-sports.io/football/teams/10214.png',
      mirassolfc: 'https://media.api-sports.io/football/teams/10214.png',
      remo: 'https://media.api-sports.io/football/teams/10213.png',
      clubedoremo: 'https://media.api-sports.io/football/teams/10213.png',
      gremio: 'https://media.api-sports.io/football/teams/130.png',
      gremiofbpa: 'https://media.api-sports.io/football/teams/130.png',
      chapecoense: 'https://media.api-sports.io/football/teams/147.png',
      chapecoenseaf: 'https://media.api-sports.io/football/teams/147.png',
      chape: 'https://media.api-sports.io/football/teams/147.png',
      acf: 'https://media.api-sports.io/football/teams/147.png',
      coritiba: 'https://media.api-sports.io/football/teams/132.png',
      coritibafbc: 'https://media.api-sports.io/football/teams/132.png',
      coxa: 'https://media.api-sports.io/football/teams/132.png',
      cfc: 'https://media.api-sports.io/football/teams/132.png',
      vitoria: 'https://media.api-sports.io/football/teams/136.png',
      ecvitoria: 'https://media.api-sports.io/football/teams/136.png',
      botafogo: 'https://media.api-sports.io/football/teams/120.png',
      botafogorj: 'https://media.api-sports.io/football/teams/120.png',
      bfr: 'https://media.api-sports.io/football/teams/120.png',
      vasco: 'https://media.api-sports.io/football/teams/133.png',
      vascodagama: 'https://media.api-sports.io/football/teams/133.png',
      crvascodagama: 'https://media.api-sports.io/football/teams/133.png',
      cruzeiro: 'https://media.api-sports.io/football/teams/135.png',
      cruzeiroec: 'https://media.api-sports.io/football/teams/135.png',
      saopaulo: 'https://media.api-sports.io/football/teams/126.png',
      spfc: 'https://media.api-sports.io/football/teams/126.png',
      santos: 'https://media.api-sports.io/football/teams/128.png',
      santosfc: 'https://media.api-sports.io/football/teams/128.png',
      fluminense: 'https://media.api-sports.io/football/teams/124.png',
      fluminensefc: 'https://media.api-sports.io/football/teams/124.png',
      flamengo: 'https://media.api-sports.io/football/teams/127.png',
      crflamengo: 'https://media.api-sports.io/football/teams/127.png',
      palmeiras: 'https://media.api-sports.io/football/teams/121.png',
      sepalmeiras: 'https://media.api-sports.io/football/teams/121.png',
      bahia: 'https://media.api-sports.io/football/teams/118.png',
      ecbahia: 'https://media.api-sports.io/football/teams/118.png',
      athleticopr: 'https://media.api-sports.io/football/teams/134.png',
      athletico: 'https://media.api-sports.io/football/teams/134.png',
      athleticoparanaense: 'https://media.api-sports.io/football/teams/134.png',
      atleticopr: 'https://media.api-sports.io/football/teams/134.png',
      atleticomineiro: 'https://media.api-sports.io/football/teams/1062.png',
      atleticomg: 'https://media.api-sports.io/football/teams/1062.png',
      cam: 'https://media.api-sports.io/football/teams/1062.png',
      internacional: 'https://media.api-sports.io/football/teams/119.png',
      inter: 'https://media.api-sports.io/football/teams/119.png',
      sci: 'https://media.api-sports.io/football/teams/119.png',
      corinthians: 'https://media.api-sports.io/football/teams/131.png',
      sccorinthianspaulista: 'https://media.api-sports.io/football/teams/131.png',
      sccp: 'https://media.api-sports.io/football/teams/131.png',
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
      psg: 'https://media.api-sports.io/football/teams/85.png',
      parissaintgermain: 'https://media.api-sports.io/football/teams/85.png',
      realmadrid: 'https://media.api-sports.io/football/teams/541.png',
      barcelona: 'https://media.api-sports.io/football/teams/529.png',
      manchestercity: 'https://media.api-sports.io/football/teams/50.png',
      liverpool: 'https://media.api-sports.io/football/teams/40.png',
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
      dinamarca: 'https://flagcdn.com/w80/dk.png',
      denmark: 'https://flagcdn.com/w80/dk.png',
    }

    var cleanK = function (s) {
      if (!s) return ''
      var str = String(s).toLowerCase().trim()
      try {
        str = str.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      } catch (_) {}
      return str.replace(/[^a-z0-9]/g, '').trim()
    }

    var tA = rec.getString('time_a') || ''
    var tB = rec.getString('time_b') || ''

    var kA = cleanK(tA)
    var kB = cleanK(tB)

    if (CANONICAL_MAP[kA]) {
      rec.set('logo_casa', CANONICAL_MAP[kA])
    }
    if (CANONICAL_MAP[kB]) {
      rec.set('logo_visitante', CANONICAL_MAP[kB])
    }
  } catch (errHook) {
    console.log('[resolver_escudo hook enquete_jogos update] Aviso:', errHook)
  }
  e.next()
}, 'enquete_jogos')

onRecordCreate((e) => {
  var rec = e.record
  try {
    var CANONICAL_MAP = {
      redbullbragantino: 'https://media.api-sports.io/football/teams/1199.png',
      rbbragantino: 'https://media.api-sports.io/football/teams/1199.png',
      bragantino: 'https://media.api-sports.io/football/teams/1199.png',
      mirassol: 'https://media.api-sports.io/football/teams/10214.png',
      mirassolfc: 'https://media.api-sports.io/football/teams/10214.png',
      remo: 'https://media.api-sports.io/football/teams/10213.png',
      clubedoremo: 'https://media.api-sports.io/football/teams/10213.png',
      gremio: 'https://media.api-sports.io/football/teams/130.png',
      gremiofbpa: 'https://media.api-sports.io/football/teams/130.png',
      chapecoense: 'https://media.api-sports.io/football/teams/147.png',
      chapecoenseaf: 'https://media.api-sports.io/football/teams/147.png',
      chape: 'https://media.api-sports.io/football/teams/147.png',
      acf: 'https://media.api-sports.io/football/teams/147.png',
      coritiba: 'https://media.api-sports.io/football/teams/132.png',
      coritibafbc: 'https://media.api-sports.io/football/teams/132.png',
      coxa: 'https://media.api-sports.io/football/teams/132.png',
      cfc: 'https://media.api-sports.io/football/teams/132.png',
      vitoria: 'https://media.api-sports.io/football/teams/136.png',
      ecvitoria: 'https://media.api-sports.io/football/teams/136.png',
      botafogo: 'https://media.api-sports.io/football/teams/120.png',
      botafogorj: 'https://media.api-sports.io/football/teams/120.png',
      bfr: 'https://media.api-sports.io/football/teams/120.png',
      vasco: 'https://media.api-sports.io/football/teams/133.png',
      vascodagama: 'https://media.api-sports.io/football/teams/133.png',
      crvascodagama: 'https://media.api-sports.io/football/teams/133.png',
      cruzeiro: 'https://media.api-sports.io/football/teams/135.png',
      cruzeiroec: 'https://media.api-sports.io/football/teams/135.png',
      saopaulo: 'https://media.api-sports.io/football/teams/126.png',
      spfc: 'https://media.api-sports.io/football/teams/126.png',
      santos: 'https://media.api-sports.io/football/teams/128.png',
      santosfc: 'https://media.api-sports.io/football/teams/128.png',
      fluminense: 'https://media.api-sports.io/football/teams/124.png',
      fluminensefc: 'https://media.api-sports.io/football/teams/124.png',
      flamengo: 'https://media.api-sports.io/football/teams/127.png',
      crflamengo: 'https://media.api-sports.io/football/teams/127.png',
      palmeiras: 'https://media.api-sports.io/football/teams/121.png',
      sepalmeiras: 'https://media.api-sports.io/football/teams/121.png',
      bahia: 'https://media.api-sports.io/football/teams/118.png',
      ecbahia: 'https://media.api-sports.io/football/teams/118.png',
      athleticopr: 'https://media.api-sports.io/football/teams/134.png',
      athletico: 'https://media.api-sports.io/football/teams/134.png',
      athleticoparanaense: 'https://media.api-sports.io/football/teams/134.png',
      atleticopr: 'https://media.api-sports.io/football/teams/134.png',
      atleticomineiro: 'https://media.api-sports.io/football/teams/1062.png',
      atleticomg: 'https://media.api-sports.io/football/teams/1062.png',
      cam: 'https://media.api-sports.io/football/teams/1062.png',
      internacional: 'https://media.api-sports.io/football/teams/119.png',
      inter: 'https://media.api-sports.io/football/teams/119.png',
      sci: 'https://media.api-sports.io/football/teams/119.png',
      corinthians: 'https://media.api-sports.io/football/teams/131.png',
      sccorinthianspaulista: 'https://media.api-sports.io/football/teams/131.png',
      sccp: 'https://media.api-sports.io/football/teams/131.png',
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
      psg: 'https://media.api-sports.io/football/teams/85.png',
      parissaintgermain: 'https://media.api-sports.io/football/teams/85.png',
      realmadrid: 'https://media.api-sports.io/football/teams/541.png',
      barcelona: 'https://media.api-sports.io/football/teams/529.png',
      manchestercity: 'https://media.api-sports.io/football/teams/50.png',
      liverpool: 'https://media.api-sports.io/football/teams/40.png',
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
      dinamarca: 'https://flagcdn.com/w80/dk.png',
      denmark: 'https://flagcdn.com/w80/dk.png',
    }

    var cleanK = function (s) {
      if (!s) return ''
      var str = String(s).toLowerCase().trim()
      try {
        str = str.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      } catch (_) {}
      return str.replace(/[^a-z0-9]/g, '').trim()
    }

    var tA = rec.getString('time_a') || ''
    var tB = rec.getString('time_b') || ''

    var kA = cleanK(tA)
    var kB = cleanK(tB)

    if (CANONICAL_MAP[kA]) {
      rec.set('url_escudo_mandante', CANONICAL_MAP[kA])
    }
    if (CANONICAL_MAP[kB]) {
      rec.set('url_escudo_visitante', CANONICAL_MAP[kB])
    }
  } catch (errHook) {
    console.log('[resolver_escudo hook jogos create] Aviso:', errHook)
  }
  e.next()
}, 'jogos')

onRecordUpdate((e) => {
  var rec = e.record
  try {
    var CANONICAL_MAP = {
      redbullbragantino: 'https://media.api-sports.io/football/teams/1199.png',
      rbbragantino: 'https://media.api-sports.io/football/teams/1199.png',
      bragantino: 'https://media.api-sports.io/football/teams/1199.png',
      mirassol: 'https://media.api-sports.io/football/teams/10214.png',
      mirassolfc: 'https://media.api-sports.io/football/teams/10214.png',
      remo: 'https://media.api-sports.io/football/teams/10213.png',
      clubedoremo: 'https://media.api-sports.io/football/teams/10213.png',
      gremio: 'https://media.api-sports.io/football/teams/130.png',
      gremiofbpa: 'https://media.api-sports.io/football/teams/130.png',
      chapecoense: 'https://media.api-sports.io/football/teams/147.png',
      chapecoenseaf: 'https://media.api-sports.io/football/teams/147.png',
      chape: 'https://media.api-sports.io/football/teams/147.png',
      acf: 'https://media.api-sports.io/football/teams/147.png',
      coritiba: 'https://media.api-sports.io/football/teams/132.png',
      coritibafbc: 'https://media.api-sports.io/football/teams/132.png',
      coxa: 'https://media.api-sports.io/football/teams/132.png',
      cfc: 'https://media.api-sports.io/football/teams/132.png',
      vitoria: 'https://media.api-sports.io/football/teams/136.png',
      ecvitoria: 'https://media.api-sports.io/football/teams/136.png',
      botafogo: 'https://media.api-sports.io/football/teams/120.png',
      botafogorj: 'https://media.api-sports.io/football/teams/120.png',
      bfr: 'https://media.api-sports.io/football/teams/120.png',
      vasco: 'https://media.api-sports.io/football/teams/133.png',
      vascodagama: 'https://media.api-sports.io/football/teams/133.png',
      crvascodagama: 'https://media.api-sports.io/football/teams/133.png',
      cruzeiro: 'https://media.api-sports.io/football/teams/135.png',
      cruzeiroec: 'https://media.api-sports.io/football/teams/135.png',
      saopaulo: 'https://media.api-sports.io/football/teams/126.png',
      spfc: 'https://media.api-sports.io/football/teams/126.png',
      santos: 'https://media.api-sports.io/football/teams/128.png',
      santosfc: 'https://media.api-sports.io/football/teams/128.png',
      fluminense: 'https://media.api-sports.io/football/teams/124.png',
      fluminensefc: 'https://media.api-sports.io/football/teams/124.png',
      flamengo: 'https://media.api-sports.io/football/teams/127.png',
      crflamengo: 'https://media.api-sports.io/football/teams/127.png',
      palmeiras: 'https://media.api-sports.io/football/teams/121.png',
      sepalmeiras: 'https://media.api-sports.io/football/teams/121.png',
      bahia: 'https://media.api-sports.io/football/teams/118.png',
      ecbahia: 'https://media.api-sports.io/football/teams/118.png',
      athleticopr: 'https://media.api-sports.io/football/teams/134.png',
      athletico: 'https://media.api-sports.io/football/teams/134.png',
      athleticoparanaense: 'https://media.api-sports.io/football/teams/134.png',
      atleticopr: 'https://media.api-sports.io/football/teams/134.png',
      atleticomineiro: 'https://media.api-sports.io/football/teams/1062.png',
      atleticomg: 'https://media.api-sports.io/football/teams/1062.png',
      cam: 'https://media.api-sports.io/football/teams/1062.png',
      internacional: 'https://media.api-sports.io/football/teams/119.png',
      inter: 'https://media.api-sports.io/football/teams/119.png',
      sci: 'https://media.api-sports.io/football/teams/119.png',
      corinthians: 'https://media.api-sports.io/football/teams/131.png',
      sccorinthianspaulista: 'https://media.api-sports.io/football/teams/131.png',
      sccp: 'https://media.api-sports.io/football/teams/131.png',
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
      psg: 'https://media.api-sports.io/football/teams/85.png',
      parissaintgermain: 'https://media.api-sports.io/football/teams/85.png',
      realmadrid: 'https://media.api-sports.io/football/teams/541.png',
      barcelona: 'https://media.api-sports.io/football/teams/529.png',
      manchestercity: 'https://media.api-sports.io/football/teams/50.png',
      liverpool: 'https://media.api-sports.io/football/teams/40.png',
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
      dinamarca: 'https://flagcdn.com/w80/dk.png',
      denmark: 'https://flagcdn.com/w80/dk.png',
    }

    var cleanK = function (s) {
      if (!s) return ''
      var str = String(s).toLowerCase().trim()
      try {
        str = str.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      } catch (_) {}
      return str.replace(/[^a-z0-9]/g, '').trim()
    }

    var tA = rec.getString('time_a') || ''
    var tB = rec.getString('time_b') || ''

    var kA = cleanK(tA)
    var kB = cleanK(tB)

    if (CANONICAL_MAP[kA]) {
      rec.set('url_escudo_mandante', CANONICAL_MAP[kA])
    }
    if (CANONICAL_MAP[kB]) {
      rec.set('url_escudo_visitante', CANONICAL_MAP[kB])
    }
  } catch (errHook) {
    console.log('[resolver_escudo hook jogos update] Aviso:', errHook)
  }
  e.next()
}, 'jogos')
