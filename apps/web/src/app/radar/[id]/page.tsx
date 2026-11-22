import { handoffRoutes } from '@fincopilot/shared-types'
import { ArrowRight, TrendingUp } from 'lucide-react'
import Link from 'next/link'
import { PlaceholderPage } from '@/components/layout/PlaceholderPage'
import { Badge, buttonVariants, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui'
import { cn } from '@/lib/utils'

export default async function RadarArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  return (
    <PlaceholderPage
      eyebrow="Phân hệ 1 · Tài"
      statusLabel="SCR-03"
      title="Chi tiết tin Radar"
      description="Dữ kiện gốc, nhãn tác động R07 và nhận định AI có trích nguồn sẽ được trình bày ở đây."
    >
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <TrendingUp size={17} className="text-primary" aria-hidden="true" />
            <Badge variant="info">Luồng 1 · Radar ➔ Survey</Badge>
          </div>
          <CardTitle className="pt-1">Thông tin bài viết & tham số cú sốc lãi suất</CardTitle>
          <CardDescription>
            Từ trang chi tiết bài viết Radar, người dùng có thể mô phỏng ngay tác động thay đổi lãi suất sang Phân hệ 2.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="divide-y divide-border rounded-lg border border-border bg-muted/40 px-4">
            <div className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
              <dt className="text-muted-foreground">Mã bài viết</dt>
              <dd className="font-mono font-semibold text-foreground font-numeric">{id}</dd>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
              <dt className="text-muted-foreground">Cú sốc lãi suất mẫu</dt>
              <dd className="font-mono font-semibold text-verdict-safe font-numeric">-1.0 điểm phần trăm</dd>
            </div>
          </dl>
        </CardContent>
        <CardFooter>
          <Link
            className={cn(buttonVariants({ variant: 'default' }))}
            href={handoffRoutes.radarToSurvey({ articleId: id, shockDelta: '-1.0' })}
          >
            Thử cú sốc lãi suất mẫu
            <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </CardFooter>
      </Card>
    </PlaceholderPage>
  )
}
