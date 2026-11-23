import { LicenseIssuer, TrustStatus } from '@fincopilot/shared-types'

// NHNN BIN register: https://sbv.gov.vn/documents/d/sbv_portal/566440
// NAPAS participants: https://www.napas.com.vn/dich-vu-chuyen-tien-nhanh-napas-247
// Additional routing codes and current names: https://www.vietqr.io/api-bank/demo
const banks = [
  ['970400', 'SaigonBank', 'Ngân hàng TMCP Sài Gòn Công Thương', 'SGB'],
  ['970403', 'Sacombank', 'Ngân hàng TMCP Sài Gòn Thương Tín', 'STB'],
  ['970405', 'Agribank', 'Ngân hàng Nông nghiệp và Phát triển Nông thôn Việt Nam', 'VBA'],
  ['970406', 'Vikki', 'Ngân hàng TNHH Một thành viên số Vikki', 'DongA Bank', 'DAB'],
  ['970407', 'Techcombank', 'Ngân hàng TMCP Kỹ thương Việt Nam', 'TCB'],
  ['970408', 'GPBank', 'Ngân hàng TNHH MTV Dầu Khí Toàn Cầu', 'GPB'],
  ['970409', 'BacABank', 'Ngân hàng TMCP Bắc Á', 'BAB'],
  ['970410', 'Standard Chartered', 'Ngân hàng TNHH MTV Standard Chartered Việt Nam', 'SCVN'],
  ['970412', 'PVcomBank', 'Ngân hàng TMCP Đại Chúng Việt Nam', 'PVCB'],
  ['970414', 'MBV', 'Ngân hàng TNHH MTV Việt Nam Hiện Đại', 'OceanBank'],
  ['970415', 'VietinBank', 'Ngân hàng TMCP Công thương Việt Nam', 'ICB', 'CTG'],
  ['970416', 'ACB', 'Ngân hàng TMCP Á Châu'],
  ['970418', 'BIDV', 'Ngân hàng TMCP Đầu tư và Phát triển Việt Nam'],
  ['970419', 'NCB', 'Ngân hàng TMCP Quốc Dân'],
  ['970421', 'VRB', 'Ngân hàng Liên doanh Việt Nga'],
  ['970422', 'MBBank', 'Ngân hàng TMCP Quân đội', 'MB', 'MBB', 'MB Bank'],
  ['970423', 'TPBank', 'Ngân hàng TMCP Tiên Phong', 'TPB'],
  ['970424', 'Shinhan Bank', 'Ngân hàng TNHH MTV Shinhan Việt Nam', 'SHBVN'],
  ['970425', 'ABBank', 'Ngân hàng TMCP An Bình', 'ABB'],
  ['970426', 'MSB', 'Ngân hàng TMCP Hàng Hải Việt Nam', 'Ngân hàng TMCP Hàng Hải', 'Maritime Bank'],
  ['970427', 'VietABank', 'Ngân hàng TMCP Việt Á', 'VAB'],
  ['970428', 'Nam A Bank', 'Ngân hàng TMCP Nam Á', 'NAB'],
  ['970429', 'SCB', 'Ngân hàng TMCP Sài Gòn'],
  ['970430', 'PGBank', 'Ngân hàng TMCP Thịnh vượng và Phát triển', 'PGB'],
  ['970431', 'Eximbank', 'Ngân hàng TMCP Xuất Nhập khẩu Việt Nam', 'EIB'],
  ['970432', 'VPBank', 'Ngân hàng TMCP Việt Nam Thịnh Vượng', 'VPB'],
  ['970433', 'VietBank', 'Ngân hàng TMCP Việt Nam Thương Tín', 'VBB'],
  ['970436', 'Vietcombank', 'Ngân hàng TMCP Ngoại thương Việt Nam', 'VCB'],
  ['970437', 'HDBank', 'Ngân hàng TMCP Phát triển Thành phố Hồ Chí Minh', 'HDB'],
  ['970438', 'BaoVietBank', 'Ngân hàng TMCP Bảo Việt', 'BVB'],
  ['970440', 'SeABank', 'Ngân hàng TMCP Đông Nam Á', 'SEAB', 'SSB'],
  ['970441', 'VIB', 'Ngân hàng TMCP Quốc tế Việt Nam'],
  ['970442', 'Hong Leong', 'Ngân hàng TNHH MTV Hong Leong Việt Nam', 'HLBVN'],
  ['970443', 'SHB', 'Ngân hàng TMCP Sài Gòn Hà Nội'],
  ['970444', 'VCBNeo', 'Ngân hàng TM TNHH MTV Ngoại thương Công nghệ số', 'CBBank', 'CB Bank'],
  ['970446', 'Co-opBank', 'Ngân hàng Hợp tác xã Việt Nam', 'COOPBANK'],
  ['970448', 'OCB', 'Ngân hàng TMCP Phương Đông'],
  ['970449', 'LPBank', 'Ngân hàng TMCP Lộc Phát Việt Nam', 'LPB', 'LienVietPostBank'],
  ['970452', 'KienlongBank', 'Ngân hàng TMCP Kiên Long', 'KLB'],
  ['970454', 'BVBank', 'Ngân hàng TMCP Bản Việt', 'VCCB', 'VietCapitalBank', 'Timo'],
  ['970457', 'Woori', 'Ngân hàng TNHH MTV Woori Việt Nam', 'WVN'],
  ['970458', 'UOB', 'Ngân hàng TNHH MTV United Overseas Bank Việt Nam'],
  ['458761', 'HSBC', 'Ngân hàng TNHH MTV HSBC Việt Nam'],
  ['422589', 'CIMB', 'Ngân hàng TNHH MTV CIMB Việt Nam'],
  ['999888', 'VBSP', 'Ngân hàng Chính sách Xã hội'],
] as const

const additionalBins = [
  ['546034', 'Cake by VPBank'], ['546035', 'Ubank by VPBank'], ['963388', 'Timo'],
  ['971133', 'PVcomBank Pay'], ['668888', 'Kasikornbank'],
  ['970466', 'KEB Hana HCM'], ['970467', 'KEB Hana Hà Nội'], ['977777', 'Mirae Asset Finance'],
  ['963668', 'BNP Paribas Hà Nội'], ['963666', 'BNP Paribas HCM'], ['555666', 'BIDC'],
  ['963688', 'Bank of China Hong Kong'], ['970465', 'SinoPac'], ['168999', 'Cathay United Bank'],
  ['963686', 'E.SUN Bank'], ['963669', 'ICBC'], ['963326', 'TNEX by MSB'],
  ['970455', 'IBK Hà Nội'], ['970456', 'IBK HCM'], ['970462', 'Kookmin Hà Nội'],
  ['970463', 'Kookmin HCM'], ['801011', 'Nonghyup Hà Nội'], ['796500', 'DBS Bank'],
  ['533948', 'Citibank'], ['971005', 'Viettel Money'], ['971011', 'VNPT Money'],
  ['971025', 'MoMo'], ['971101', 'ZaloPay'], ['971032', 'MobiFone Money'],
] as const

const bins = new Map<string, string>(banks.map(([bin, label]) => [bin, label]))
for (const [bin, label] of additionalBins) bins.set(bin, label)
export const bankNameForBin = (bin: string): string | null => bins.get(bin) ?? null

// Finance snapshot and brand changes: https://www.sfinance.com.vn/kien-thuc/danh-sach-16-cong-ty-tai-chinh-uy-tin-cho-vay-online-tra-gop-2026
const financeCompanies = [
  ['FE Credit', 'VPB SMBC FC', 'Công ty Tài chính TNHH Ngân hàng Việt Nam Thịnh Vượng SMBC'],
  ['Home Credit', 'Công ty Tài chính TNHH MTV Home Credit Việt Nam'],
  ['HD Saison', 'Công ty Tài chính TNHH HD Saison'],
  ['Mcredit', 'Công ty Tài chính TNHH MB Shinsei'],
  ['TNEX Finance', 'Công ty Tài chính TNHH MTV TNEX', 'FCCOM'],
  ['Shinhan Finance', 'Công ty Tài chính TNHH MTV Shinhan Việt Nam', 'SVFC'],
  ['Mirae Asset Finance', 'Công ty Tài chính TNHH MTV Mirae Asset Việt Nam', 'MAFC'],
  ['Lotte Finance', 'Công ty Tài chính TNHH MTV Lotte Việt Nam'],
  ['SFinance', 'SHB Finance', 'Công ty Tài chính TNHH Ngân hàng TMCP Sài Gòn Hà Nội'],
  ['VietCredit', 'Công ty Tài chính Cổ phần Tín Việt'],
  ['AEON Finance', 'PTF', 'Công ty Tài chính TNHH MTV AEON', 'Công ty Tài chính TNHH MTV Bưu điện'],
  ['JACCS', 'Công ty Tài chính TNHH MTV Quốc tế Việt Nam JACCS'],
  ['EVN Finance', 'Công ty Tài chính Cổ phần Điện lực'],
  ['Toyota Financial Services', 'Công ty Tài chính TNHH MTV Toyota Việt Nam', 'TFSVN'],
  ['HAFIC', 'Công ty Tài chính Cổ phần HANDICO'],
  ['VFC', 'Công ty Tài chính TNHH MTV Công nghiệp Tàu thủy'],
]

// Payment-intermediary disclosures: https://www.momo.vn/dieu-khoan-dieu-le
// https://zalopay.vn/quy-dinh/quy-che-hoat-dong
const wallets = [
  ['MoMo', 'M-Service', 'Công ty Cổ phần Dịch vụ Di động Trực tuyến'],
  ['ZaloPay', 'ZION', 'Công ty Cổ phần ZION'],
  ['ShopeePay', 'AirPay', 'Công ty Cổ phần ShopeePay'],
  ['VNPAY', 'Công ty Cổ phần Giải pháp Thanh toán Việt Nam'],
  ['Payoo', 'VietUnion', 'Công ty Cổ phần Dịch vụ Trực tuyến Cộng Đồng Việt'],
  ['Viettel Money', 'ViettelPay', 'Tổng Công ty Dịch vụ số Viettel'],
  ['VNPT Money', 'VNPT Pay', 'Tổng Công ty Truyền thông VNPT'],
  ['MobiFone Money', 'Tổng Công ty Viễn thông MobiFone'],
  ['9Pay', 'Công ty Cổ phần 9Pay'],
  ['Ngân Lượng', 'NganLuong', 'Công ty Cổ phần Ngân Lượng'],
  ['Bảo Kim', 'BaoKim', 'Công ty Cổ phần Thương mại Điện tử Bảo Kim'],
  ['VTC Pay', 'Tổng Công ty Truyền thông Đa phương tiện VTC'],
]

// SSC public disclosures and license information: https://fms.ssc.gov.vn/newslist
const securitiesAndFunds = [
  ['SSI', 'Công ty Cổ phần Chứng khoán SSI'],
  ['VPS', 'Công ty Cổ phần Chứng khoán VPS'],
  ['VNDIRECT', 'Công ty Cổ phần Chứng khoán VNDIRECT', 'VND'],
  ['HSC', 'Công ty Cổ phần Chứng khoán Thành phố Hồ Chí Minh'],
  ['TCBS', 'Công ty Cổ phần Chứng khoán Kỹ thương'],
  ['VCI', 'Vietcap', 'Công ty Cổ phần Chứng khoán Vietcap'],
  ['MBS', 'Công ty Cổ phần Chứng khoán MB'],
  ['VCBS', 'Công ty TNHH Chứng khoán Ngân hàng TMCP Ngoại thương Việt Nam'],
  ['BSC', 'Công ty Cổ phần Chứng khoán BIDV'],
  ['SSIAM', 'Công ty TNHH Quản lý Quỹ SSI'],
  ['VCFM', 'VinaCapital', 'Công ty Cổ phần Quản lý Quỹ VinaCapital'],
  ['DCVFM', 'Dragon Capital', 'Công ty Cổ phần Quản lý Quỹ Đầu tư Dragon Capital Việt Nam'],
  ['Vietcombank Fund Management', 'VCBF', 'Công ty Liên doanh Quản lý Quỹ Đầu tư Chứng khoán Vietcombank'],
  ['Techcom Capital', 'TCC', 'Công ty Cổ phần Quản lý Quỹ Kỹ Thương'],
  ['MB Capital', 'Công ty Cổ phần Quản lý Quỹ Đầu tư MB'],
  ['Bao Viet Fund', 'BVF', 'Công ty TNHH Quản lý Quỹ Bảo Việt'],
]

export interface CatalogInstitution {
  code: string
  name: string
  licenseIssuer: string
  trustStatus: string
  vietqrBin?: string | null
}

export function normalizeVietnamese(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ').trim()
}

function institutionKey(value: string): string {
  return normalizeVietnamese(value)
    .replace(/\bthuong mai co phan\b/g, 'tmcp')
    .replace(/\btrach nhiem huu han\b/g, 'tnhh')
    .replace(/\bmot thanh vien\b/g, 'mtv')
    .replace(/\bctcp\b/g, 'cong ty co phan')
    .replace(/\s+/g, '')
}

// This offline reference is a public-data snapshot. A matching DB entry takes priority.
const fallbackInstitutions = [
  ...banks.map(([vietqrBin, ...aliases]) => ({ aliases, vietqrBin, licenseIssuer: 'NHNN' })),
  ...[...financeCompanies, ...wallets].map((aliases) => ({ aliases, licenseIssuer: 'NHNN' })),
  ...securitiesAndFunds.map((aliases) => ({ aliases, licenseIssuer: 'UBCKNN' })),
].map((institution) => ({ ...institution, trustStatus: 'LICENSED' }))
const names = new Map(fallbackInstitutions.flatMap((entry) =>
  entry.aliases.map((alias) => [institutionKey(alias), entry] as const)))

export function findInstitution(name: string, catalog: readonly CatalogInstitution[]) {
  const key = institutionKey(name)
  const fallback = names.get(key) ?? names.get(key.replace(/^(nganhang|vidientu|chungkhoan)/, ''))
  const exact = catalog.find((entry) => [entry.code, entry.name].some((value) => institutionKey(value) === key))
  const resolved = exact ?? (fallback && catalog.find((entry) =>
    [entry.code, entry.name].some((value) => names.get(institutionKey(value)) === fallback)
    || (entry.vietqrBin && 'vietqrBin' in fallback && entry.vietqrBin === fallback.vietqrBin)))
  const institution = resolved ?? fallback
  const issuer = LicenseIssuer.safeParse(institution?.licenseIssuer)
  const status = TrustStatus.safeParse(institution?.trustStatus)
  return issuer.success && status.success ? { issuer: issuer.data, status: status.data } : null
}

// Source evidence for the four tactics:
// https://www.ic3.gov/PSA/2025/PSA250813
// https://tinnhiemmang.vn/canh-bao-mao-danh-ngan-hang-huong-dan-nguoi-dung-xac-thuc-sinh-trac-hoc
// https://www.scamshield.gov.sg/i-want-protection-from-scams/learn-to-recognise-scams/investment-scams/
// https://www.ic3.gov/PSA/2024/PSA241203
export const scamTactics = {
  recovery: {
    topic: /\b(thu hoi|lay lai|hoan lai|hoan tra|khoi phuc) (?:so )?(?:tien|tai san|von)\b/,
    corroboration: /\b(chuyen phi|nop phi|tra phi|dong phi|phi truoc|phi xu ly|phi dich vu|phi hoan tien|phi khoi phuc|ma thu hoi)\b/,
  },
  biometric: {
    topic: /\b(otp|sinh trac hoc|quet (?:nhan dien )?khuon mat|xac thuc khuon mat)\b/,
    corroboration: /\b(link la|duong dan la|app la|ung dung la|cai dat|chia se man hinh|gui (?:ma )?otp|cung cap (?:ma )?otp|doc (?:ma )?otp)\b/,
  },
  exchange: {
    topic: /\b(san (?:crypto|tien ao|giao dich|dau tu)|vi crypto|vi tien ao|san binance)\b/,
    corroboration: /\b(nap them|nap phi|mo khoa rut|dong thue|nop thue|phi rut tien|san gia|app gia|web gia|mao danh|nhai)\b/,
  },
  coercion: {
    topic: /\b(deepfake|gia (?:giong|mat)|gia mao (?:video|giong noi)|bat coc|tong tien|gia danh (?:cong an|toa an)|cuoc goi video)\b/,
    corroboration: /\b(chuyen tien ngay|chuyen gap|nop tien ngay|tien chuoc|giai cuu|chung minh (?:thu nhap|vo toi)|giu bi mat)\b/,
  },
}
