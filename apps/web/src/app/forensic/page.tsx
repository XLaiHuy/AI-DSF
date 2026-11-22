import { parseForensicHandoff, type RouteSearchParams } from '@fincopilot/shared-types'
import { PlaceholderPage } from '@/components/layout/PlaceholderPage'

export default async function ForensicPage({ searchParams }: { searchParams: Promise<RouteSearchParams> }) {
  const { claimedEntity, from } = parseForensicHandoff(await searchParams)

  return (
    <PlaceholderPage title="Giám định tài chính" description="Kiểm tra điều khoản vay, mã VietQR và dấu hiệu lừa đảo.">
      {claimedEntity && (
        <dl className="handoff">
          <div><dt>Đơn vị cần kiểm tra</dt><dd>{claimedEntity}</dd></div>
          {from === 'trust-filter' && <div><dt>Chuyển từ</dt><dd>Bộ lọc tin cậy</dd></div>}
        </dl>
      )}
    </PlaceholderPage>
  )
}
