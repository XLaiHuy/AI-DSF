import { Suspense } from 'react'
import { SurveyRouteWorkspace } from '@/components/survey/SurveyRouteWorkspace'
import SurveySkeleton from './loading'

export default function SurveyPage() {
  return <Suspense fallback={<SurveySkeleton />}><SurveyRouteWorkspace /></Suspense>
}
