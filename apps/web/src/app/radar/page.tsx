import { ROUTES } from '@fincopilot/shared-types'
import { Activity, ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { PlaceholderPage } from '@/components/layout/PlaceholderPage'
import { Badge, buttonVariants, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui'
import { cn } from '@/lib/utils'

export default function RadarPage() {
  return (
    <PlaceholderPage
      eyebrow="Phân hệ 1 · Tài"
      statusLabel="SCR-02"
      title="Radar thị trường"
      description="Nơi theo dõi tin thị trường từ CafeF, VnEconomy, Vietstock cùng cảnh báo xác minh từ NHNN và NCSC."
    >
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Activity size={17} className="text-primary" aria-hidden="true" />
            <Badge variant="info">Chờ tích hợp RadarModule (Phase 2)</Badge>
          </div>
          <CardTitle className="pt-1">Luồng chi tiết bài viết & cảnh báo</CardTitle>
          <CardDescription>
            Mở trang chi tiết mẫu để kiểm tra điều hướng sang SCR-03 và cầu nối cú sốc lãi suất về Khảo sát.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Thành phần giao diện của Phân hệ 1 đặt tại <code className="font-mono text-xs text-foreground">src/components/radar/</code>.
          </p>
        </CardContent>
        <CardFooter>
          <Link className={cn(buttonVariants({ variant: 'default' }))} href={ROUTES.radarArticle('mau')}>
            Mở trang chi tiết mẫu
            <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </CardFooter>
      </Card>
    </PlaceholderPage>
  )
}
