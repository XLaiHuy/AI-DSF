'use client'

import { parseSurveyHandoff } from '@fincopilot/shared-types'
import { useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { useWorkspaceSession } from '@/components/layout/WorkspaceSessionContext'
import SurveyWorkspace from './SurveyWorkspace'

export function SurveyRouteWorkspace() {
  const params = useSearchParams()
  const { viewerKey } = useWorkspaceSession()
  const handoff = useMemo(() => parseSurveyHandoff(Object.fromEntries(params.entries())), [params])
  return <SurveyWorkspace key={[viewerKey, handoff.sessionId].join(':')} handoff={handoff} />
}
