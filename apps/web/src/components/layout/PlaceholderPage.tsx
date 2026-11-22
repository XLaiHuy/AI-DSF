import type { ReactNode } from 'react'

export function PlaceholderPage({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children?: ReactNode
}) {
  return (
    <div className="page">
      <h1>{title}</h1>
      <p className="page-description">{description}</p>
      {children}
    </div>
  )
}
