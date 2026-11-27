import type { ForensicTaxonomyMatch } from '@fincopilot/shared-types'
import { normalizeVietnamese } from './data/trusted-institutions'

type Entry = readonly [
  string, ForensicTaxonomyMatch['vnAisGroup'], string, ForensicTaxonomyMatch['targetAudience'], RegExp,
]

// VN-AIS follows the order of the 2023 Cục An toàn thông tin campaign list.
const entries: readonly Entry[] = [
  ['Mời mua gói du lịch giá rẻ', 'COMBINED_SCAM', 'Lừa đảo mua sắm', 'GENERAL', /\b(?:combo du lich|du lich gia re|dat phong gia re)\b/],
  ['Giả hình ảnh hoặc giọng nói khi gọi', 'BRAND_IMPERSONATION', 'Lừa đảo mạo danh', 'GENERAL', /\b(?:deepfake|deepvoice|gia giong noi|cuoc goi video gia)\b/],
  ['Dọa khóa SIM để lấy thông tin', 'ACCOUNT_HIJACK', 'Đánh cắp danh tính', 'ELDERLY', /\b(?:khoa sim|chuan hoa thue bao|chuan hoa sim)\b/],
  ['Làm giả biên lai chuyển tiền', 'COMBINED_SCAM', 'Lừa đảo hóa đơn', 'BUSINESS_OWNER', /\b(?:gia (?:mao )?bien lai|bien lai (?:ao|gia)|gia hoa don chuyen tien)\b/],
  ['Giả danh trường học hoặc bệnh viện báo cấp cứu', 'BRAND_IMPERSONATION', 'Lừa đảo mạo danh', 'GENERAL', /\b(?:giao vien|benh vien|nhan vien y te|bac si)\b.{0,110}\b(?:cap cuu|tai nan|mo gap)\b|\b(?:bao|dang) cap cuu\b/],
  ['Dụ đăng ký làm người mẫu nhí', 'COMBINED_SCAM', 'Lừa đảo tuyển dụng', 'GENERAL', /\b(?:nguoi mau nhi|tuyen mau nhi)\b/],
  ['Mạo danh ngân hàng hoặc công ty tài chính', 'BRAND_IMPERSONATION', 'Lừa đảo mạo danh', 'GENERAL', /\b(?:gia danh|mao danh)\b.{0,32}\b(?:ngan hang|cong ty tai chinh)\b|\b(?:phi giai ngan|loi 102)\b/],
  ['Dụ cài ứng dụng cá độ hoặc vay rủi ro', 'COMBINED_SCAM', 'Lừa đảo đầu tư', 'STUDENT', /\b(?:co bac|ca do|tin dung den)\b.{0,75}\b(?:app|ung dung|link)\b|\b(?:app|ung dung|link)\b.{0,75}\b(?:co bac|ca do|tin dung den)\b/],
  ['Làm giả trang web của cơ quan hoặc doanh nghiệp', 'BRAND_IMPERSONATION', 'Lừa đảo mạo danh', 'GENERAL', /\b(?:trang web|website|trang thong tin|cong thong tin)\b.{0,55}\b(?:gia mao|gia|nhai)\b|\bgia mao (?:website|trang)\b/],
  ['Gửi tin nhắn giả mang tên thương hiệu', 'BRAND_IMPERSONATION', 'Lừa đảo mạo danh', 'GENERAL', /\b(?:sms brandname|tin nhan brandname|sms gia mao|sms gia)\b/],
  ['Dụ đầu tư chứng khoán, tiền mã hóa hoặc đa cấp', 'COMBINED_SCAM', 'Lừa đảo đầu tư', 'WORKER', /\b(?:chung khoan (?:quoc te|ao|gia)|san (?:tien ao|crypto) gia|dau tu (?:chung khoan|tien ao)|da cap|bao loi nhuan|uy thac dau tu)\b/],
  ['Dụ nộp tiền để làm cộng tác viên qua mạng', 'COMBINED_SCAM', 'Lừa đảo tuyển dụng', 'STUDENT', /\b(?:tuyen (?:cong tac vien|ctv)|viec nhe luong cao|lam nhiem vu online|cong tac vien online)\b/],
  ['Chiếm tài khoản mạng xã hội để nhắn tin vay tiền', 'ACCOUNT_HIJACK', 'Đánh cắp danh tính', 'GENERAL', /\b(?:chiem quyen|danh cap|hack|mat)\b.{0,25}\b(?:tai khoan (?:mang xa hoi|mxh)|facebook|zalo)\b/],
  ['Giả danh công an, viện kiểm sát hoặc tòa án', 'BRAND_IMPERSONATION', 'Lừa đảo mạo danh', 'ELDERLY', /\b(?:gia danh|mao danh)\b.{0,32}\b(?:cong an|vien kiem sat|toa an)\b|\b(?:cong an|vien kiem sat|toa an)\b.{0,45}\b(?:goi|cai app|chuyen tien)\b/],
  ['Rao bán hàng giả trên sàn thương mại điện tử', 'COMBINED_SCAM', 'Lừa đảo mua sắm', 'GENERAL', /\b(?:hang gia|hang nhai)\b/],
  ['Lấy thông tin căn cước để vay tiền', 'ACCOUNT_HIJACK', 'Đánh cắp danh tính', 'WORKER', /\b(?:cccd|can cuoc)\b.{0,60}\b(?:vay no|vay tin dung|vay tien|mo khoan vay)\b|\bdanh cap (?:thong tin )?(?:cccd|can cuoc)\b/],
  ['Giả vờ chuyển nhầm tiền để đòi lại', 'COMBINED_SCAM', 'Lừa đảo báo có tiền bất ngờ', 'GENERAL', /\b(?:lua dao chuyen nham|gia vo chuyen nham|tien chuyen nham)\b/],
  ['Hứa lấy lại tiền đã mất để thu phí', 'COMBINED_SCAM', 'Lừa đảo thu hồi tiền', 'GENERAL', /\b(?:lay lai tien (?:bi lua|da mat)|thu hoi tien (?:bi lua|da mat|lua dao)|dich vu lay lai tien)\b/],
  ['Dụ cung cấp mã xác nhận Telegram', 'ACCOUNT_HIJACK', 'Đánh cắp danh tính', 'GENERAL', /\btelegram\b.{0,40}\botp\b|\botp\b.{0,40}\btelegram\b/],
  ['Tung tin giả về cuộc gọi làm mất tiền', 'COMBINED_SCAM', 'Lừa đảo mạo danh', 'GENERAL', /\b(?:flash ?ai|cuoc goi mat tien)\b/],
  ['Dụ trả phí để lấy lại tài khoản Facebook', 'ACCOUNT_HIJACK', 'Đánh cắp danh tính', 'GENERAL', /\b(?:lay lai|khoi phuc|mo khoa)\b.{0,30}\b(?:facebook|tai khoan fb)\b/],
  ['Lợi dụng tình cảm, quà hoặc bưu kiện để đòi tiền', 'COMBINED_SCAM', 'Lừa đảo tình cảm', 'GENERAL', /\b(?:lua dao tinh cam|hen ho dau tu|buu kien trung thuong|gui qua tu nuoc ngoai|nhan qua trung thuong)\b/],
  ['Rải đường dẫn giả để lấy thông tin đăng nhập', 'ACCOUNT_HIJACK', 'Đánh cắp danh tính', 'GENERAL', /\b(?:phishing|link gia|duong dan gia|quang cao ban|bam link xac minh|link lay mat khau)\b/],
  ['Dụ mua số đánh đề hoặc số chắc trúng', 'COMBINED_SCAM', 'Lừa đảo báo có tiền bất ngờ', 'GENERAL', /\b(?:cho so danh de|ban so de|so de chac trung|xin so lo de)\b/],
]

export const vnScamTaxonomy: readonly ForensicTaxonomyMatch[] = entries.map(([vnAisLabel, vnAisGroup, gasaCategory, targetAudience], index) => ({
  vnAisCode: 'VN-AIS-' + String(index + 1).padStart(2, '0'), vnAisLabel, vnAisGroup, gasaCategory, targetAudience,
}))

const directRules: Readonly<Record<string, number>> = {
  RULE_01_UPFRONT_FEE_QR: 7, RULE_02_ERROR_102_FREEZE_TRAP: 7,
  RULE_07_PONZI_UNREALISTIC_RETURN: 11, RULE_08_RECOVERY_SCAM_TRAP: 18, RULE_10_FAKE_EXCHANGE_CRYPTO_CLONE: 11,
}
const categoryFallback: Readonly<Record<string, number>> = {
  PHISHING: 23, FAKE_APP: 23, PONZI: 11, RECOVERY_SCAM: 18, IMPERSONATION: 7, IDENTITY_THEFT: 16,
}

export function classifyVnScamTaxonomy(input: {
  text?: string | null; ruleCodes?: readonly string[]; threatCategory?: string | null; qrSchemes?: readonly string[]
}): ForensicTaxonomyMatch[] {
  const text = normalizeVietnamese(input.text ?? '')
  const matches = new Set<number>()
  for (const rule of input.ruleCodes ?? []) {
    if (directRules[rule]) matches.add(directRules[rule])
  }
  entries.forEach(([, , , , pattern], index) => { if (pattern.test(text)) matches.add(index + 1) })
  if (!matches.size && input.threatCategory && categoryFallback[input.threatCategory]) {
    matches.add(categoryFallback[input.threatCategory])
  }
  return [...matches].map(index => vnScamTaxonomy[index - 1])
}
