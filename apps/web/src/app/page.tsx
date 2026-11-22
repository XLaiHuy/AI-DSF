import { handoffRoutes, ROUTES } from '@fincopilot/shared-types'
import { Activity, ArrowRight, Calculator, ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import { PlaceholderPage } from '@/components/layout/PlaceholderPage'
import { Badge, buttonVariants, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui'
import { cn } from '@/lib/utils'

const pillars = [
  {
    href: ROUTES.radar,
    badge: 'Phân hệ 1 · Tài',
    badgeVariant: 'info' as const,
    icon: Activity,
    title: 'Radar thị trường & Cảnh báo',
    description: 'Tổng hợp tin tài chính từ 5 nguồn tin cậy, khử trùng lặp và gắn cờ chỉ dấu rủi ro từ NHNN/NCSC.',
    cta: 'Mở Radar',
  },
  {
    href: ROUTES.survey,
    badge: 'Phân hệ 2 · Tân',
    badgeVariant: 'safe' as const,
    icon: Calculator,
    title: 'Khảo sát vay & Tích lũy',
    description: 'Tính toán chuẩn xác bằng decimal.js (EMI, APR/EAR, DTI), đối chiếu sản phẩm qua Bộ lọc Tin cậy.',
    cta: 'Mở Khảo sát',
  },
  {
    href: ROUTES.forensic,
    badge: 'Phân hệ 3 · Lead',
    badgeVariant: 'warning' as const,
    icon: ShieldCheck,
    title: 'Giám định hợp đồng & VietQR',
    description: 'Giải mã VietQR, đọc điều khoản PDF và đối chiếu 7 Luật Cứng nhằm phát hiện dấu hiệu lừa đảo.',
    cta: 'Mở Giám định',
  },
]

export default function HomePage() {
  return (
    <PlaceholderPage
      eyebrow="Editorial Fintech Shell"
      statusLabel="Lead · SCR-01"
      title="Tổng quan tài chính"
      description="Theo dõi tin thị trường, chuẩn bị phương án vay an toàn và giám định dấu hiệu rủi ro trên một luồng liên kết khép kín."
    >
      <Card className="border-primary/20 bg-gradient-to-br from-card via-card to-accent/30">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Badge variant="safe">Khảo sát nhanh · URL Handoff</Badge>
            <span className="font-mono text-xs text-muted-foreground font-numeric">50.000.000 VND · 24 tháng</span>
          </div>
          <CardTitle className="pt-1 text-lg">Ước tính nhanh phương án vay tiêu chuẩn</CardTitle>
          <CardDescription>
            Kiểm thử liên kết trực tiếp từ Trang chủ sang Phân hệ 2 với tham số khoản vay mẫu.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Link
            className={cn(buttonVariants({ variant: 'default', size: 'lg' }))}
            href={handoffRoutes.quickSurvey({ amount: '50000000', term: 24 })}
          >
            Thử khảo sát vay mẫu
            <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </CardFooter>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        {pillars.map(({ href, badge, badgeVariant, icon: Icon, title, description, cta }) => (
          <Card key={href} className="flex flex-col justify-between">
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <span className="grid size-9 place-items-center rounded-lg bg-muted text-primary">
                  <Icon size={18} aria-hidden="true" />
                </span>
                <Badge variant={badgeVariant}>{badge}</Badge>
              </div>
              <CardTitle className="pt-2">{title}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <Link className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'w-full justify-between')} href={href}>
                <span>{cta}</span>
                <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>
    </PlaceholderPage>
  )
}
