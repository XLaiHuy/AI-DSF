import { parseSurveyHandoff, type RouteSearchParams } from '@fincopilot/shared-types'
import SurveyWorkspace from '@/components/survey/SurveyWorkspace'

export default async function SurveyPage({ searchParams }: { searchParams: Promise<RouteSearchParams> }) {
  const handoff = parseSurveyHandoff(await searchParams)
  return <SurveyWorkspace key={JSON.stringify(handoff)} handoff={handoff} />
}
