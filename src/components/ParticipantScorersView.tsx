import { useState, useMemo } from 'react'
import { ChevronDown, ChevronUp, Eye, ShieldAlert, Award } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { extractScorerNames } from '@/lib/scorerUtils'

export interface ParticipantScorersViewProps {
  participanteNome: string
  timeA: string
  timeB: string
  placarA: number
  placarB: number
  scorersA?: string[]
  scorersB?: string[]
  rawGolsA?: any
  rawGolsB?: any
  jogoGolsA?: any
  jogoGolsB?: any
}

export type ScorerPosition = 'Goleiro' | 'Defensor' | 'Atacante' | 'Gol Contra'

export interface ParsedScorerItem {
  id: string
  nome: string
  posicao: ScorerPosition
  isGolContra: boolean
  displayLabel: string
}

function normalizeCompare(name: string): string {
  return (name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Normaliza um item ou string de marcador resolvendo flag de gol contra e posição.
 */
function resolveScorerItem(
  rawItem: any,
  teamGolsBanco: any[],
  sidePrefix: string,
  index: number,
): ParsedScorerItem {
  let rawStr = ''
  let explicitPos: string | undefined
  let explicitGolContra = false

  if (typeof rawItem === 'string') {
    rawStr = rawItem.trim()
  } else if (rawItem && typeof rawItem === 'object') {
    rawStr = String(rawItem.nome || rawItem.name || '').trim()
    explicitPos = rawItem.posicao ? String(rawItem.posicao) : undefined
    explicitGolContra = Boolean(rawItem.gol_contra)
  }

  const isContraPattern =
    explicitGolContra ||
    /\(gol contra\)|\(contra\)/i.test(rawStr) ||
    Boolean(explicitPos && explicitPos.toLowerCase().includes('contra'))

  const cleanName = rawStr.replace(/\(gol contra\)|\(contra\)/gi, '').trim()
  const compClean = normalizeCompare(cleanName)

  // Tenta encontrar nos dados do jogo (gols_time_a / gols_time_b)
  let foundInBanco: any = null
  if (Array.isArray(teamGolsBanco) && compClean) {
    foundInBanco = teamGolsBanco.find((g: any) => {
      const gName = typeof g === 'string' ? g : g?.nome || ''
      const gClean = normalizeCompare(gName.replace(/\(gol contra\)|\(contra\)/gi, ''))
      return (
        gClean === compClean ||
        (gClean.length > 3 && compClean.includes(gClean)) ||
        (compClean.length > 3 && gClean.includes(compClean))
      )
    })
  }

  const bancoPos = foundInBanco?.posicao ? String(foundInBanco.posicao).toLowerCase() : ''
  const bancoIsContra =
    foundInBanco?.gol_contra === true ||
    bancoPos.includes('contra') ||
    (typeof foundInBanco === 'string' && /\(gol contra\)|\(contra\)/i.test(foundInBanco))

  const finalIsContra = isContraPattern || bancoIsContra

  let posicao: ScorerPosition
  if (finalIsContra) {
    posicao = 'Gol Contra'
  } else {
    const posCandidate = (explicitPos || bancoPos || '').toLowerCase()
    const nameCandidate = cleanName.toLowerCase()

    if (posCandidate.includes('goleiro') || nameCandidate.includes('goleiro')) {
      posicao = 'Goleiro'
    } else if (
      posCandidate.includes('defensor') ||
      posCandidate.includes('zagueiro') ||
      posCandidate.includes('lateral') ||
      nameCandidate.includes('zagueiro') ||
      nameCandidate.includes('lateral') ||
      nameCandidate.includes('defensor')
    ) {
      posicao = 'Defensor'
    } else {
      posicao = 'Atacante'
    }
  }

  return {
    id: `${sidePrefix}-${index}-${cleanName}`,
    nome: cleanName,
    posicao,
    isGolContra: finalIsContra,
    displayLabel: finalIsContra ? `${cleanName} (gol contra)` : cleanName,
  }
}

/**
 * Converte qualquer fonte de goleadores para uma lista tipada de ParsedScorerItem.
 */
function buildParsedList(
  providedScorers: string[] | undefined,
  rawGols: any,
  teamGolsBanco: any,
  expectedCount: number,
  sidePrefix: string,
): ParsedScorerItem[] {
  let sourceItems: any[] = []

  if (Array.isArray(rawGols)) {
    sourceItems = rawGols
  } else if (typeof rawGols === 'string' && rawGols.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(rawGols)
      if (Array.isArray(parsed)) sourceItems = parsed
    } catch {
      // fallback
    }
  }

  if (sourceItems.length === 0 && providedScorers && providedScorers.length > 0) {
    sourceItems = providedScorers
  }

  if (sourceItems.length === 0 && rawGols) {
    sourceItems = extractScorerNames(rawGols)
  }

  const bancoList: any[] = Array.isArray(teamGolsBanco)
    ? teamGolsBanco
    : typeof teamGolsBanco === 'string'
      ? extractScorerNames(teamGolsBanco)
      : []

  const result: ParsedScorerItem[] = []
  const count = Math.max(sourceItems.length, 0)

  for (let i = 0; i < count; i++) {
    const item = resolveScorerItem(sourceItems[i], bancoList, sidePrefix, i)
    if (item.nome) {
      result.push(item)
    }
  }

  return result
}

function getPositionBadgeVariant(pos: ScorerPosition) {
  switch (pos) {
    case 'Gol Contra':
      return {
        badgeClass: 'bg-rose-100 text-rose-800 border-rose-300',
        label: 'Gol Contra (+5 pts)',
        pts: '+5 pts',
      }
    case 'Goleiro':
      return {
        badgeClass: 'bg-purple-100 text-purple-800 border-purple-300',
        label: 'Goleiro (+10 pts)',
        pts: '+10 pts',
      }
    case 'Defensor':
      return {
        badgeClass: 'bg-blue-100 text-blue-800 border-blue-300',
        label: 'Defensor (+3 pts)',
        pts: '+3 pts',
      }
    case 'Atacante':
    default:
      return {
        badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-300',
        label: 'Atacante / Meia (+1 pt)',
        pts: '+1 pt',
      }
  }
}

export function ParticipantScorersView({
  participanteNome,
  timeA,
  timeB,
  placarA,
  placarB,
  scorersA,
  scorersB,
  rawGolsA,
  rawGolsB,
  jogoGolsA,
  jogoGolsB,
}: ParticipantScorersViewProps) {
  const [expanded, setExpanded] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)

  const is0x0 = placarA === 0 && placarB === 0

  const itemsA = useMemo(
    () => buildParsedList(scorersA, rawGolsA, jogoGolsA, placarA, 'A'),
    [scorersA, rawGolsA, jogoGolsA, placarA],
  )
  const itemsB = useMemo(
    () => buildParsedList(scorersB, rawGolsB, jogoGolsB, placarB, 'B'),
    [scorersB, rawGolsB, jogoGolsB, placarB],
  )

  const summaryA = itemsA.map((i) => i.displayLabel).join(', ')
  const summaryB = itemsB.map((i) => i.displayLabel).join(', ')

  const totalScorersCount = itemsA.length + itemsB.length
  const totalChars = summaryA.length + summaryB.length

  // Mostrar botões de ação quando houver mais de 1 marcador no total ou o texto for longo (> 25 chars)
  const shouldShowControls = totalScorersCount > 1 || totalChars > 25

  if (is0x0) {
    return <div className="mt-1 text-[10px] text-slate-400 italic">Sem marcadores (0x0)</div>
  }

  return (
    <div className="mt-1.5 space-y-1 border-t border-slate-200/60 pt-1 text-[11px] leading-snug">
      {/* Visualização Colapsada vs Expandida */}
      {!expanded ? (
        <div className="space-y-0.5">
          <div className="text-slate-700">
            <span className="font-semibold text-slate-800">Gols Mandante:</span>{' '}
            <span
              className={
                itemsA.length === 0 ? 'text-slate-400' : 'text-slate-900 font-medium break-words'
              }
            >
              {itemsA.length === 0 ? '-' : summaryA}
            </span>
          </div>
          <div className="text-slate-700">
            <span className="font-semibold text-slate-800">Gols Visitante:</span>{' '}
            <span
              className={
                itemsB.length === 0 ? 'text-slate-400' : 'text-slate-900 font-medium break-words'
              }
            >
              {itemsB.length === 0 ? '-' : summaryB}
            </span>
          </div>
        </div>
      ) : (
        <div className="space-y-2 py-0.5 animate-in fade-in-50 duration-150">
          <div>
            <div className="font-semibold text-slate-800 text-[10px] uppercase tracking-wider mb-1">
              Gols {timeA}:
            </div>
            {itemsA.length === 0 ? (
              <span className="text-slate-400 text-[10px] italic">-</span>
            ) : (
              <div className="flex flex-wrap gap-1">
                {itemsA.map((item) => {
                  const meta = getPositionBadgeVariant(item.posicao)
                  return (
                    <span
                      key={item.id}
                      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium border ${meta.badgeClass}`}
                    >
                      <span className="font-bold">{item.nome}</span>
                      <span className="text-[9px] opacity-80">({meta.pts})</span>
                      {item.isGolContra && (
                        <span className="rounded bg-rose-600 px-1 py-0 text-[8px] font-bold text-white uppercase">
                          contra
                        </span>
                      )}
                    </span>
                  )
                })}
              </div>
            )}
          </div>

          <div>
            <div className="font-semibold text-slate-800 text-[10px] uppercase tracking-wider mb-1">
              Gols {timeB}:
            </div>
            {itemsB.length === 0 ? (
              <span className="text-slate-400 text-[10px] italic">-</span>
            ) : (
              <div className="flex flex-wrap gap-1">
                {itemsB.map((item) => {
                  const meta = getPositionBadgeVariant(item.posicao)
                  return (
                    <span
                      key={item.id}
                      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium border ${meta.badgeClass}`}
                    >
                      <span className="font-bold">{item.nome}</span>
                      <span className="text-[9px] opacity-80">({meta.pts})</span>
                      {item.isGolContra && (
                        <span className="rounded bg-rose-600 px-1 py-0 text-[8px] font-bold text-white uppercase">
                          contra
                        </span>
                      )}
                    </span>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Barra de controles: expandir/colapsar + botão detalhes (Dialog) */}
      {shouldShowControls && (
        <div className="flex items-center justify-between pt-1 mt-1 border-t border-slate-100">
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-emerald-700 hover:text-emerald-800 hover:underline transition"
          >
            {expanded ? (
              <>
                <ChevronUp className="h-3 w-3" />
                <span>ver menos</span>
              </>
            ) : (
              <>
                <ChevronDown className="h-3 w-3" />
                <span>+ ver mais</span>
              </>
            )}
          </button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setDialogOpen(true)}
            className="h-5 px-1.5 text-[10px] text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded inline-flex items-center gap-1"
            title="Ver detalhes completos dos marcadores"
          >
            <Eye className="h-2.5 w-2.5" />
            <span>detalhes</span>
          </Button>
        </div>
      )}

      {/* Dialog limpo shadcn/ui listando todos os marcadores por time */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md w-full">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-[#0F172A] flex items-center gap-2">
              <Award className="h-4 w-4 text-emerald-600" />
              <span>Palpite de {participanteNome}</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              {timeA} {placarA} x {placarB} {timeB}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 text-xs">
            {/* Bloco Time A */}
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
              <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-slate-200">
                <span className="font-bold text-[#0F172A]">{timeA}</span>
                <Badge variant="outline" className="text-[10px] font-semibold">
                  {placarA} gol{placarA === 1 ? '' : 's'}
                </Badge>
              </div>

              {itemsA.length === 0 ? (
                <p className="text-[11px] text-slate-400 italic">
                  {placarA === 0
                    ? 'Nenhum gol previsto para esta equipe.'
                    : 'Nenhum marcador registrado.'}
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {itemsA.map((sc, idx) => {
                    const meta = getPositionBadgeVariant(sc.posicao)
                    return (
                      <li
                        key={sc.id}
                        className="flex items-center justify-between rounded bg-white px-2.5 py-1.5 border border-slate-200/80 shadow-2xs"
                      >
                        <div className="flex items-center gap-2">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-600">
                            {idx + 1}
                          </span>
                          <span className="font-semibold text-slate-800">{sc.nome}</span>
                        </div>
                        {sc.isGolContra ? (
                          <span className="inline-flex items-center gap-1 rounded bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800 border border-rose-300">
                            <ShieldAlert className="h-3 w-3" />
                            Gol Contra (+5 pts)
                          </span>
                        ) : (
                          <span
                            className={`rounded px-2 py-0.5 text-[10px] font-semibold border ${meta.badgeClass}`}
                          >
                            {meta.label}
                          </span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            {/* Bloco Time B */}
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
              <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-slate-200">
                <span className="font-bold text-[#0F172A]">{timeB}</span>
                <Badge variant="outline" className="text-[10px] font-semibold">
                  {placarB} gol{placarB === 1 ? '' : 's'}
                </Badge>
              </div>

              {itemsB.length === 0 ? (
                <p className="text-[11px] text-slate-400 italic">
                  {placarB === 0
                    ? 'Nenhum gol previsto para esta equipe.'
                    : 'Nenhum marcador registrado.'}
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {itemsB.map((sc, idx) => {
                    const meta = getPositionBadgeVariant(sc.posicao)
                    return (
                      <li
                        key={sc.id}
                        className="flex items-center justify-between rounded bg-white px-2.5 py-1.5 border border-slate-200/80 shadow-2xs"
                      >
                        <div className="flex items-center gap-2">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-600">
                            {idx + 1}
                          </span>
                          <span className="font-semibold text-slate-800">{sc.nome}</span>
                        </div>
                        {sc.isGolContra ? (
                          <span className="inline-flex items-center gap-1 rounded bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800 border border-rose-300">
                            <ShieldAlert className="h-3 w-3" />
                            Gol Contra (+5 pts)
                          </span>
                        ) : (
                          <span
                            className={`rounded px-2 py-0.5 text-[10px] font-semibold border ${meta.badgeClass}`}
                          >
                            {meta.label}
                          </span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
