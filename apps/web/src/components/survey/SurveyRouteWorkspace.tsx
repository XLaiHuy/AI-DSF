'use client'

import { parseSurveyHandoff } from '@fincopilot/shared-types'
import { useSearchParams } from 'next/navigation'
import SurveyWorkspace from './SurveyWorkspace'

export function SurveyRouteWorkspace() {
  const params = useSearchParams()
  const handoff = parseSurveyHandoff(Object.fromEntries(params.entries()))
  return <SurveyWorkspace key={JSON.stringify(handoff)} handoff={handoff} />
}
