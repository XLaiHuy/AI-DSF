import { ROUTES } from '@fincopilot/shared-types'
import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { PlaceholderPage } from '@/components/layout/PlaceholderPage'

export default function RadarPage() {
  return (
    <PlaceholderPage title="Radar thị trường" description="Nơi theo dõi tin thị trường và cảnh báo đã xác minh.">
      <Link className="page-action" href={ROUTES.radarArticle('mau')}>
        Mở trang chi tiết mẫu <ArrowRight size={18} aria-hidden="true" />
      </Link>
    </PlaceholderPage>
  )
}
