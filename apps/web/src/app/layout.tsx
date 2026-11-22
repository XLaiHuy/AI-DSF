import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { QueryProvider } from '@/components/layout/QueryProvider'
import './globals.css'

export const metadata: Metadata = {
  title: { default: 'FinCopilot AI', template: '%s · FinCopilot AI' },
  description: 'Radar, khảo sát và giám định tài chính.',
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="vi">
      <body>
        <QueryProvider>
          <AppShell>{children}</AppShell>
        </QueryProvider>
      </body>
    </html>
  )
}
