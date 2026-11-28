export type BankSupportContact = { name: string; hotline: string; websiteUrl: string }

// The official contact pages document the retail support numbers below.
export const bankSupportDirectory: Readonly<Partial<Record<string, BankSupportContact>>> = {
  '970403': { name: 'Sacombank', hotline: '1800 5858 88', websiteUrl: 'https://www.sacombank.com.vn/trang-chu/lien-he.html' },
  '970405': { name: 'Agribank', hotline: '1900 558818', websiteUrl: 'https://www.agribank.com.vn/vn/lai-suat-tien-gui' },
  '970407': { name: 'Techcombank', hotline: '1800 588 822', websiteUrl: 'https://techcombank.com/lien-he' },
  '970415': { name: 'VietinBank', hotline: '1900 558 868', websiteUrl: 'https://contact.vietinbank.vn/' },
  '970416': { name: 'ACB', hotline: '1900 54 54 86', websiteUrl: 'https://acb.com.vn/lien-he?tab=2' },
  '970418': { name: 'BIDV', hotline: '1900 9247', websiteUrl: 'https://bidv.com.vn/vn/ca-nhan/lien-he' },
  '970422': { name: 'MBBank', hotline: '1900 545426', websiteUrl: 'https://www.mbbank.com.vn/lien-he' },
  '970423': { name: 'TPBank', hotline: '1900 58 58 85', websiteUrl: 'https://tpb.vn/wps/portal/vni/faqs/ngan-hang-ca-nhan' },
  '970426': { name: 'MSB', hotline: '1900 6083', websiteUrl: 'https://www.msb.com.vn/' },
  '970432': { name: 'VPBank', hotline: '1900 54 54 15', websiteUrl: 'https://www.vpbank.com.vn/bi-kip-va-chia-se/retail-story-and-tips/goc-canh-giac/canh-giac-chieu-gia-mao-nhan-vien-ngan-hang-de-ho-tro-mo-lai-tai-khoan-bi-khoa' },
  '970436': { name: 'Vietcombank', hotline: '1900 54 54 13', websiteUrl: 'https://www.vietcombank.com.vn/KHCN/Lien-he-va-Ho-tro/Lien-he-Cham-soc-khach-hang' },
  '970437': { name: 'HDBank', hotline: '1900 6060', websiteUrl: 'https://hdbank.com.vn/contact' },
  '970441': { name: 'VIB', hotline: '1900 2200', websiteUrl: 'https://www.vib.com.vn/vn/lien-he' },
  '970443': { name: 'SHB', hotline: '*6688', websiteUrl: 'https://www.shb.com.vn/shb-thong-bao-dau-so-hotline-cua-trung-tam-ho-tro-khach-hang-24-7/' },
  '970448': { name: 'OCB', hotline: '1800 6678', websiteUrl: 'https://ocb.com.vn/vi' },
  '970449': { name: 'LPBank', hotline: '*8668', websiteUrl: 'https://lpbank.com.vn/cham-soc-khach-hang' },
  '971025': { name: 'MoMo', hotline: '1900 54 54 41', websiteUrl: 'https://www.momo.vn/hoi-dap/cach-lien-he-voi-momo' },
  '971101': { name: 'ZaloPay', hotline: '1900 54 54 36', websiteUrl: 'https://zalopay.vn/quy-dinh/thoa-thuan-su-dung-zalopay' },
}

export function bankSupportForBin(bin: string | null | undefined) {
  return bin && /^\d{6}$/.test(bin) ? bankSupportDirectory[bin] : undefined
}

export function walletSupportForProvider(label: string | null | undefined) {
  const provider = label?.toLowerCase()
  return bankSupportForBin(provider === 'momo' ? '971025' : provider === 'zalopay' ? '971101' : undefined)
}
