import { parseSurveyHandoff, type RouteSearchParams } from '@fincopilot/shared-types'
import SurveyWorkspace from '@/components/survey/SurveyWorkspace'

export default async function SurveyPage({ searchParams }: { searchParams: Promise<RouteSearchParams> }) {
  return <SurveyWorkspace handoff={parseSurveyHandoff(await searchParams)} />
}
