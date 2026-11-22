import { handoffRoutes } from '@fincopilot/shared-types'
import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { PlaceholderPage } from '@/components/layout/PlaceholderPage'

export default function HomePage() {
  return (
    <PlaceholderPage title="Tổng quan tài chính" description="Theo dõi tin thị trường, chuẩn bị phương án vay và kiểm tra dấu hiệu rủi ro.">
      <Link className="page-action" href={handoffRoutes.quickSurvey({ amount: '50000000', term: 24 })}>
        Thử khảo sát vay mẫu <ArrowRight size={18} aria-hidden="true" />
      </Link>
    </PlaceholderPage>
  )
}
