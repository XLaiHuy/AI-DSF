const categoryLabels: Record<string, string> = {
  INTEREST_RATE: 'Lãi suất', BANKING: 'Ngân hàng', MARKET: 'Thị trường',
  POLICY: 'Chính sách', INFLATION: 'Lạm phát', FINANCIAL_FRAUD: 'Lừa đảo tài chính',
}

export function CategoryArtwork({ categories, className = '' }: { categories: string[]; className?: string }) {
  const category = categories[0] ?? 'MARKET'
  const topic = categoryLabels[category] ?? 'Tin thị trường'
  return <div className={`radar-category-art radar-category-art--${category.toLocaleLowerCase('en-US')} ${className}`} role="img" aria-label={`Minh họa chủ đề ${topic}, không phải ảnh sự kiện`}>
    <svg viewBox="0 0 320 190" aria-hidden="true" focusable="false">
      <rect x="35" y="20" width="250" height="138" rx="1" />
      <path d="M51 37h93M51 45h61M164 37h102M164 45h78M51 59h215M51 68h215M51 83h83M51 91h83M51 99h83M51 107h83M51 115h83M51 123h83M157 59v70M174 83h92M174 91h80M174 103h92M174 111h70M174 123h86" />
      <circle cx="238" cy="139" r="10" />
      <path d="M28 169h76M28 177h46M216 169h77M247 177h46" />
    </svg>
    <span>Minh họa chủ đề · {topic}</span>
  </div>
}
