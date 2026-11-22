import { handoffRoutes } from '@fincopilot/shared-types'
import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { PlaceholderPage } from '@/components/layout/PlaceholderPage'

export default async function RadarArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  return (
    <PlaceholderPage title="Chi tiết tin Radar" description="Dữ kiện gốc và nhận định AI sẽ được trình bày riêng ở đây.">
      <dl className="handoff"><div><dt>Mã bài viết</dt><dd>{id}</dd></div></dl>
      <Link className="page-action" href={handoffRoutes.radarToSurvey({ articleId: id, shockDelta: '-1.0' })}>
        Thử cú sốc lãi suất mẫu <ArrowRight size={18} aria-hidden="true" />
      </Link>
    </PlaceholderPage>
  )
}
