export function WorkspaceSkeleton({ label }: { label: string }) {
  return <div className="mx-auto max-w-6xl space-y-6" role="status">
    <span className="sr-only">{label}</span>
    <div aria-hidden="true" className="h-9 w-1/2 rounded-lg bg-muted motion-safe:animate-pulse" />
    <div aria-hidden="true" className="h-40 rounded-xl border border-border bg-muted/50 motion-safe:animate-pulse" />
  </div>
}
