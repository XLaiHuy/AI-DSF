import { parseSurveyHandoff, type RouteSearchParams } from '@fincopilot/shared-types'
import { PlaceholderPage } from '@/components/layout/PlaceholderPage'

export default async function SurveyPage({ searchParams }: { searchParams: Promise<RouteSearchParams> }) {
  const { amount, term, shockDelta, from, articleId, auditId } = parseSurveyHandoff(await searchParams)
  const values = [
    ['Số tiền', amount && `${amount} VND`],
    ['Kỳ hạn', term === undefined ? undefined : `${term} tháng`],
    ['Thay đổi lãi suất', shockDelta && `${shockDelta} điểm phần trăm`],
    ['Chuyển từ', from && (from === 'radar' ? 'Radar' : 'Giám định')],
    ['Mã bài viết', articleId],
    ['Mã báo cáo', auditId],
  ].filter(([, value]) => value !== undefined)

  return (
    <PlaceholderPage title="Khảo sát và tính toán" description="So sánh khoản vay, xem lựa chọn tích lũy hoặc tính từ dữ liệu nhập tay.">
      {values.length > 0 && (
        <dl className="handoff">
          {values.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
      )}
    </PlaceholderPage>
  )
}
