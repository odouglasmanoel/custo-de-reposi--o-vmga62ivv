import React, { useState, useEffect, useCallback } from 'react'
import {
  ChevronDown,
  ChevronUp,
  Shield,
  Users,
  CheckCircle2,
  HelpCircle,
  AlertCircle,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { fetchGameLineup, LineupResponse, LineupTeam } from '@/services/escalacoes'

interface GameLineupAccordionProps {
  jogoId: string
  fixtureId?: string
  timeA: string
  timeB: string
  data?: string
  onLineupLoaded?: (lineup: LineupResponse) => void
}

export const GameLineupAccordion: React.FC<GameLineupAccordionProps> = ({
  jogoId,
  fixtureId,
  timeA,
  timeB,
  data,
  onLineupLoaded,
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [lineup, setLineup] = useState<LineupResponse | null>(null)
  const [activeTab, setActiveTab] = useState<'timeA' | 'timeB'>('timeA')

  const loadLineup = useCallback(
    async (force = false) => {
      setLoading(true)
      try {
        const res = await fetchGameLineup({
          jogoId,
          fixtureId,
          timeA,
          timeB,
          data,
          forceRefresh: force,
        })
        setLineup(res)
        if (onLineupLoaded) {
          onLineupLoaded(res)
        }
      } catch (err) {
        console.warn('Erro ao carregar escalação:', err)
      } finally {
        setLoading(false)
      }
    },
    [jogoId, fixtureId, timeA, timeB, data, onLineupLoaded],
  )

  const handleToggle = () => {
    const nextState = !isOpen
    setIsOpen(nextState)
    if (nextState && !lineup && !loading) {
      loadLineup(false)
    }
  }

  // Identifica time A e time B no retorno
  const teamAData = lineup?.teams?.[0]
  const teamBData = lineup?.teams?.[1]
  const currentTeam: LineupTeam | undefined = activeTab === 'timeA' ? teamAData : teamBData
  const currentTeamName = activeTab === 'timeA' ? timeA : timeB

  const isConfirmed = lineup?.status === 'confirmada'
  const isProbable = lineup?.status === 'provavel'
  const isUnavailable = !lineup || lineup.status === 'indisponivel'

  return (
    <div className="mt-2.5 rounded-lg border border-slate-200 bg-slate-50/70 overflow-hidden text-xs transition">
      {/* Botão retrátil [ Ver Escalações ] */}
      <button
        type="button"
        onClick={handleToggle}
        className="w-full flex items-center justify-between px-3 py-2 text-slate-700 hover:bg-slate-100 transition font-medium"
      >
        <div className="flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5 text-[#0F2A43]" />
          <span className="font-semibold text-[#0F2A43]">
            {isOpen ? 'Ocultar Escalações' : 'Ver Escalações'}
          </span>
          {lineup && (
            <Badge
              variant="outline"
              className={`text-[9px] px-1.5 py-0 font-bold uppercase tracking-wider ${
                isConfirmed
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                  : isProbable
                    ? 'border-amber-300 bg-amber-50 text-amber-800'
                    : 'border-slate-300 bg-white text-slate-500'
              }`}
            >
              {isConfirmed ? 'Confirmada' : isProbable ? 'Prováveis' : 'Indisponível'}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1 text-slate-400">
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-[#0F2A43]" />}
          {isOpen ? (
            <ChevronUp className="h-4 w-4 text-slate-600" />
          ) : (
            <ChevronDown className="h-4 w-4 text-slate-600" />
          )}
        </div>
      </button>

      {/* Conteúdo expandido */}
      {isOpen && (
        <div className="p-3 border-t border-slate-200/80 bg-white animate-in fade-in duration-200">
          {loading && !lineup ? (
            <div className="py-6 flex flex-col items-center justify-center gap-2 text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin text-[#0F2A43]" />
              <span className="text-[11px] font-medium">Buscando escalações...</span>
            </div>
          ) : isUnavailable || (!teamAData?.starters?.length && !teamBData?.starters?.length) ? (
            <div className="py-4 text-center">
              <div className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-slate-100 text-slate-400 mb-1.5">
                <HelpCircle className="h-4 w-4" />
              </div>
              <p className="text-xs font-semibold text-slate-700">
                Escalações ainda não confirmadas pelas equipes
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5 max-w-xs mx-auto">
                As escalações oficiais costumam ser confirmadas entre 30 e 60 minutos antes do apito
                inicial.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => loadLineup(true)}
                disabled={loading}
                className="mt-2.5 h-7 text-[11px] gap-1 border-slate-300 text-[#0F2A43]"
              >
                <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
                <span>Verificar novamente</span>
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Header de status e refresh */}
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <div className="flex items-center gap-1.5">
                  {isConfirmed ? (
                    <div className="flex items-center gap-1 text-[11px] font-bold text-emerald-800">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                      <span>Escalações Confirmadas</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 text-[11px] font-bold text-amber-800">
                      <AlertCircle className="h-3.5 w-3.5 text-amber-600" />
                      <span>Prováveis Titulares / Elenco</span>
                    </div>
                  )}
                  {currentTeam?.formation && (
                    <Badge
                      variant="secondary"
                      className="text-[9px] px-1 py-0 font-bold bg-slate-100 text-slate-700"
                    >
                      {currentTeam.formation}
                    </Badge>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => loadLineup(true)}
                  disabled={loading}
                  className="inline-flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-900 transition"
                  title="Atualizar escalações da API"
                >
                  <RefreshCw
                    className={`h-3 w-3 ${loading ? 'animate-spin text-[#0F2A43]' : ''}`}
                  />
                  <span>Atualizar</span>
                </button>
              </div>

              {/* Seletor de time (Tabs Mandante / Visitante) */}
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-0.5 text-center">
                <button
                  type="button"
                  onClick={() => setActiveTab('timeA')}
                  className={`py-1 px-2 rounded-md font-bold text-[11px] transition truncate ${
                    activeTab === 'timeA'
                      ? 'bg-white text-[#0F2A43] shadow-2xs font-extrabold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {timeA}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('timeB')}
                  className={`py-1 px-2 rounded-md font-bold text-[11px] transition truncate ${
                    activeTab === 'timeB'
                      ? 'bg-white text-[#0F2A43] shadow-2xs font-extrabold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {timeB}
                </button>
              </div>

              {/* Lista compacta de Titulares e Reservas */}
              <div className="space-y-2.5">
                {/* Titulares */}
                <div>
                  <div className="flex items-center justify-between pb-1 border-b border-slate-100 mb-1.5">
                    <span className="text-[11px] font-bold text-slate-800 flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-emerald-500 inline-block" />
                      {isConfirmed ? 'Titulares Confirmados' : 'Prováveis Titulares'}
                    </span>
                    <span className="text-[10px] font-semibold text-slate-400">
                      {currentTeam?.starters?.length || 0} jogadores
                    </span>
                  </div>

                  {currentTeam?.starters && currentTeam.starters.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 max-h-48 overflow-y-auto pr-1">
                      {currentTeam.starters.map((player, idx) => (
                        <div
                          key={player.id || `${player.name}_${idx}`}
                          className="flex items-center justify-between rounded px-1.5 py-1 text-[11px] bg-slate-50 border border-slate-100 hover:bg-emerald-50/50 transition"
                        >
                          <div className="flex items-center gap-1.5 truncate">
                            {player.number ? (
                              <span className="font-mono text-[9px] font-bold text-slate-400 w-4 shrink-0 text-center">
                                #{player.number}
                              </span>
                            ) : (
                              <span className="font-mono text-[9px] font-bold text-slate-300 w-4 shrink-0 text-center">
                                •
                              </span>
                            )}
                            <span
                              className="font-semibold text-slate-800 truncate"
                              title={player.name}
                            >
                              {player.name}
                            </span>
                          </div>
                          {player.pos && (
                            <span className="text-[9px] font-bold text-slate-400 uppercase shrink-0">
                              {player.pos}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] italic text-slate-400 py-1 text-center">
                      Nenhum titular listado ainda.
                    </p>
                  )}
                </div>

                {/* Reservas / Banco */}
                {currentTeam?.substitutes && currentTeam.substitutes.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between pb-1 border-b border-slate-100 mb-1.5">
                      <span className="text-[11px] font-bold text-slate-700 flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full bg-amber-400 inline-block" />
                        Banco de Reservas
                      </span>
                      <span className="text-[10px] font-semibold text-slate-400">
                        {currentTeam.substitutes.length} suplentes
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 max-h-40 overflow-y-auto pr-1">
                      {currentTeam.substitutes.map((player, idx) => (
                        <div
                          key={player.id || `sub_${player.name}_${idx}`}
                          className="flex items-center justify-between rounded px-1.5 py-1 text-[11px] bg-slate-50/80 border border-slate-100 hover:bg-amber-50/50 transition"
                        >
                          <div className="flex items-center gap-1.5 truncate">
                            {player.number ? (
                              <span className="font-mono text-[9px] font-bold text-slate-400 w-4 shrink-0 text-center">
                                #{player.number}
                              </span>
                            ) : (
                              <span className="font-mono text-[9px] font-bold text-slate-300 w-4 shrink-0 text-center">
                                •
                              </span>
                            )}
                            <span
                              className="font-medium text-slate-700 truncate"
                              title={player.name}
                            >
                              {player.name}
                            </span>
                          </div>
                          {player.pos && (
                            <span className="text-[9px] font-bold text-slate-400 uppercase shrink-0">
                              {player.pos}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Técnico */}
                {currentTeam?.coach && (
                  <div className="pt-1.5 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500">
                    <span className="font-medium">Técnico:</span>
                    <span className="font-bold text-slate-700">{currentTeam.coach}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
