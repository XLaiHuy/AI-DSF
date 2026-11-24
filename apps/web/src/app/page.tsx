import { ROUTES } from '@fincopilot/shared-types'
import { Activity, ArrowRight, Calculator, ScanLine } from 'lucide-react'
import Link from 'next/link'
import { OverviewWidgets } from '@/components/home/OverviewWidgets'
import { buttonVariants, Card } from '@/components/ui'
import { cn } from '@/lib/utils'

const pillars = [
  {
    href: ROUTES.radar, icon: Activity, title: 'Radar thị trường',
    description: 'Theo dõi tin tài chính và cảnh báo từ những nguồn đã đối chiếu.',
  },
  {
    href: ROUTES.survey, icon: Calculator, title: 'Khảo sát & tính toán',
    description: 'So sánh chi phí vay, sức trả nợ và các phương án tích lũy.',
  },
  {
    href: ROUTES.forensic, icon: ScanLine, title: 'Giám định tài chính',
    description: 'Kiểm tra hợp đồng, tin nhắn đòi tiền và tài khoản nhận qua VietQR.',
  },
]

export default function HomePage() {
  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <header className="space-y-2">
        <h1 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">Tổng quan tài chính</h1>
        <p className="max-w-[65ch] text-sm leading-relaxed text-muted-foreground sm:text-base">
          Theo dõi thị trường, chuẩn bị phương án vay và kiểm tra trước khi chuyển tiền.
        </p>
      </header>

      <OverviewWidgets>
        <section className="grid gap-5 rounded-xl bg-primary p-6 text-primary-foreground sm:p-8" aria-labelledby="quick-forensic-title">
          <ScanLine size={29} strokeWidth={1.6} aria-hidden="true" />
          <div className="space-y-2">
            <h2 id="quick-forensic-title" className="max-w-[22ch] text-balance text-2xl font-bold tracking-tight sm:text-3xl">
              Kiểm tra trước khi chuyển tiền
            </h2>
            <p className="max-w-[49ch] text-sm leading-relaxed text-primary-foreground/90">
              Nhận được hợp đồng, tin nhắn đòi nộp phí hoặc mã VietQR lạ? Hãy đối chiếu giấy phép và dấu hiệu rủi ro trước khi giao dịch.
            </p>
          </div>
          <Link href={ROUTES.forensic} className={cn(buttonVariants({ variant: 'secondary' }), 'min-h-11 w-fit')}>
            Bắt đầu giám định <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </section>
      </OverviewWidgets>

      <section aria-labelledby="tools-title" className="space-y-3">
        <h2 id="tools-title" className="text-lg font-semibold">Công cụ tài chính</h2>
        <Card className="divide-y divide-border">
          {pillars.map(({ href, icon: Icon, title, description }) => (
            <Link key={href} href={href} className="group flex min-h-16 items-center gap-3 rounded-xl p-4 hover:bg-muted sm:gap-4 sm:px-5">
              <Icon className="shrink-0 text-primary" size={22} strokeWidth={1.7} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold">{title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p>
              </div>
              <ArrowRight className="shrink-0 text-primary" size={17} aria-hidden="true" />
            </Link>
          ))}
        </Card>
      </section>
    </div>
  )
}
