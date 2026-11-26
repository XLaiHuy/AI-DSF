const categoryLabels: Record<string, string> = {
  INTEREST_RATE: 'Lãi suất', BANKING: 'Ngân hàng', MARKET: 'Thị trường',
  POLICY: 'Chính sách', INFLATION: 'Lạm phát', FINANCIAL_FRAUD: 'Lừa đảo tài chính',
}

export function CategoryArtwork({ categories, className = '' }: { categories: string[]; className?: string }) {
  const category = categories.find((item) => item in categoryLabels) ?? 'MARKET'
  const topic = categoryLabels[category] ?? 'Tin thị trường'
  return <div className={`radar-category-art radar-category-art--${category.toLocaleLowerCase('en-US')} ${className}`} role="img" aria-label={`Minh họa chủ đề ${topic}, không phải ảnh sự kiện`}>
    <svg viewBox="0 0 320 190" aria-hidden="true" focusable="false">
      {category === 'INTEREST_RATE' && <>
        <path d="M28 146H293M44 151V30M44 116H292M44 79H292M44 42H292" />
        <path d="M48 126L91 112L130 119L171 77L213 91L277 47" strokeWidth="2.5" />
        <circle cx="171" cy="77" r="5" /><circle cx="277" cy="47" r="5" />
        <path d="M62 162h54M196 162h80" />
      </>}
      {category === 'BANKING' && <>
        <path d="M31 66L160 27L289 66M36 69H284M44 145H277M31 157H289M56 69v75M80 69v75M113 69v75M137 69v75M183 69v75M207 69v75M240 69v75M264 69v75" />
        <circle cx="160" cy="49" r="7" /><path d="M99 169h122" />
      </>}
      {category === 'FINANCIAL_FRAUD' && <>
        <rect x="42" y="30" width="150" height="107" rx="5" /><path d="M57 53h119M57 68h88M57 84h103M57 100h73" />
        <path d="M235 53l48 19v32c0 28-18 48-48 61-30-13-48-33-48-61V72z" strokeWidth="2" />
        <path d="M235 78v35M235 126v3" strokeWidth="4" />
      </>}
      {category === 'POLICY' && <>
        <path d="M72 25h140l35 34v107H72zM212 25v34h35M91 55h91M91 73h119M91 91h119M91 109h80" />
        <circle cx="204" cy="133" r="17" /><path d="M196 134l5 5 10-12" />
      </>}
      {category === 'INFLATION' && <>
        <path d="M39 151H286M49 150V38M63 124h32v26H63zM111 108h32v42h-32zM159 86h32v64h-32zM207 54h32v96h-32z" />
        <path d="M60 89L103 79L150 87L197 54L255 41M249 35l8 6-7 8" strokeWidth="2" />
      </>}
      {category === 'MARKET' && <>
        <path d="M28 144H292M36 34h248M36 55h248M36 76h248M36 97h248M36 118h248" />
        <path d="M49 118l37-28 32 13 43-52 33 26 39-17 37 12" strokeWidth="2.5" />
        <circle cx="161" cy="51" r="5" /><path d="M48 163h79M190 163h85" />
      </>}
    </svg>
    <span>Minh họa chủ đề · {topic}</span>
  </div>
}
