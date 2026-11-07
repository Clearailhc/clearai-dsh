import type { SessionProjectionSummaryExcluded } from '@deepseek-ai/dsh-session-projection/types'

export type ResearchEventCategory = 'hypothesis' | 'structure' | 'entities' | 'validation' | 'handoff' | 'adjudication' | 'outcome' | 'integrity'
export interface ResearchEventRecord {
  v: number
  id: string
  category: ResearchEventCategory
  sourceSeq: number
  sourceCallId: string | null
  example: boolean
  turn: number | null
  step: number | null
  taskId: string | null
  time: number | null
  objects: { kind: string; id: string; label: string }[]
  summary: string[]
  refutationCondition?: string | null
  status: string
  links: { kind: string; path?: string; sessionId?: string }[]
  revision: number | null
  replaces: string | null
  sourceTypes: string[]
  changes?: number
}
export interface ResearchProjectionView {
  sessionId: string
  v: number
  bySeq: Record<string, ResearchEventRecord[]>
}
export interface ResearchProjectionState extends ResearchProjectionView {
  taskId: string | null
  seen: Record<string, number>
  objectTasks: Record<string, string | null>
}
export const RESEARCH_EVENT_VERSION: number
export function mutationsFromResearchEvent(event: unknown): Record<string, unknown>[]
export function researchEvents(event: unknown, mutations?: Record<string, unknown>[]): ResearchEventRecord[]
export function emptyResearchProjection(sessionId: string): ResearchProjectionState
export function applyResearchProjection(state: ResearchProjectionState, event: unknown): ResearchProjectionState
export function researchProjectionView(state: ResearchProjectionState): ResearchProjectionView

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    clearaiResearch: SessionProjectionSummaryExcluded<ResearchProjectionView>
  }
}
