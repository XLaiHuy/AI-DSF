'use client'

import type { ForensicAuditFields, ForensicAuditResponse, ForensicFollowUpResponse, ForensicGuidance } from '@fincopilot/shared-types'
import { useQuery } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode, type SetStateAction } from 'react'
import { sessionQuery } from '@/lib/workspace-data'
import { clearConversationCache } from '../forensic/conversation-cache'
import { createSurveySession, type SurveySession } from '../survey/survey-session'
import type { RadarTab } from './RadarDeskContext'

export type PreAuditTurnUi = { question: string; answer: string; guidance?: ForensicGuidance }
export type ForensicReply = Omit<ForensicFollowUpResponse, 'meta'> & {
  question: string; streamed: boolean; meta?: ForensicFollowUpResponse['meta']
}
export type ForensicConversation = {
  audit: ForensicAuditResponse
  submission: { text: string; context: string; fields?: ForensicAuditFields }
  replies: ForensicReply[]
}
type ForensicSession = {
  conversation?: ForensicConversation
  preAuditTurns: PreAuditTurnUi[]
  draft: string
  entity: string
  sourceAlertId?: string
  handoffKey?: string
  conversationSession?: { owner: string; id: string; expiresAt: number }
}
type RadarSession = {
  tab: RadarTab
  category: string
  search: string
  period: 'all' | 'today' | '7d' | 'month' | 'year' | 'custom'
  year: string
  dateFrom: string
  dateTo: string
  scrollByTab: Partial<Record<RadarTab, number>>
}

type WorkspaceSessions = { forensic: ForensicSession; survey: SurveySession; radar: RadarSession }
type Scope = keyof WorkspaceSessions
const emptyForensic = (): ForensicSession => ({ preAuditTurns: [], draft: '', entity: '' })
const emptySessions = (): WorkspaceSessions => ({
  forensic: emptyForensic(),
  survey: createSurveySession(),
  radar: { tab: 'articles', category: '', search: '', period: 'all', year: String(new Date().getFullYear()), dateFrom: '', dateTo: '', scrollByTab: {} },
})

type SessionContext = {
  viewerKey?: string
  sessions: WorkspaceSessions
  update: <K extends Scope>(scope: K, change: (previous: WorkspaceSessions[K]) => WorkspaceSessions[K]) => void
  clearForensicSession: () => void
  clearSurveySession: () => void
  clearAllWorkspaceSessions: () => void
}
const WorkspaceSessionContext = createContext<SessionContext | null>(null)

export function WorkspaceSessionProvider({ children }: { children: ReactNode }) {
  const session = useQuery(sessionQuery)
  const viewerKey = session.data?.kind === 'user' ? 'user:' + session.data.user.id : session.data?.kind === 'guest' ? 'guest' : undefined
  const [store, setStore] = useState(() => ({ viewerKey, sessions: emptySessions() }))
  if (store.viewerKey !== viewerKey) {
    // The first guest response confirms the visitor who is already using the public workspace.
    const firstGuest = store.viewerKey === undefined && viewerKey === 'guest'
    setStore({ viewerKey, sessions: firstGuest ? store.sessions : emptySessions() })
  }

  useEffect(() => {
    if (viewerKey) clearConversationCache({ unlessOwner: viewerKey })
  }, [viewerKey])

  const update = useCallback<SessionContext['update']>((scope, change) => {
    setStore((previous) => previous.viewerKey !== viewerKey && !(viewerKey === undefined && previous.viewerKey === 'guest') ? previous : {
      viewerKey: previous.viewerKey, sessions: { ...previous.sessions, [scope]: change(previous.sessions[scope]) },
    })
  }, [viewerKey])
  const clearForensicSession = useCallback(() => update('forensic', emptyForensic), [update])
  const clearSurveySession = useCallback(() => update('survey', createSurveySession), [update])
  const clearAllWorkspaceSessions = useCallback(() => {
    clearConversationCache()
    setStore({ viewerKey, sessions: emptySessions() })
  }, [viewerKey])
  const sessions = store.sessions
  const value = useMemo(() => ({
    viewerKey, sessions, update, clearForensicSession, clearSurveySession, clearAllWorkspaceSessions,
  }), [viewerKey, sessions, update, clearForensicSession, clearSurveySession, clearAllWorkspaceSessions])

  return <WorkspaceSessionContext.Provider value={value}>{children}</WorkspaceSessionContext.Provider>
}

export function useWorkspaceSession() {
  const context = useContext(WorkspaceSessionContext)
  if (!context) throw new Error('WorkspaceSessionProvider is required')
  return context
}

export function useWorkspaceField<S extends Scope, K extends keyof WorkspaceSessions[S]>(scope: S, key: K) {
  const { sessions, update } = useWorkspaceSession()
  const set = useCallback((value: SetStateAction<WorkspaceSessions[S][K]>) => {
    update(scope, (previous) => ({
      ...previous, [key]: typeof value === 'function'
        ? (value as (old: WorkspaceSessions[S][K]) => WorkspaceSessions[S][K])(previous[key]) : value,
    }))
  }, [scope, key, update])
  return [sessions[scope][key], set] as const
}
