import { z } from 'zod'

export const VerdictLevel = z.enum(['SAFE', 'CAUTION', 'HIGH_RISK'])
export type VerdictLevel = z.infer<typeof VerdictLevel>

export const RuleCode = z.enum([
  'RULE_01_UPFRONT_FEE_QR', 'RULE_02_ERROR_102_FREEZE_TRAP', 'RULE_03_ENTITY_MISMATCH',
  'RULE_04_UNLICENSED_OR_IMPERSONATION', 'RULE_05_NCSC_THREAT_MATCH',
  'RULE_06_FLAT_RATE_AND_USURY_APR', 'RULE_07_PONZI_UNREALISTIC_RETURN',
  'RULE_08_RECOVERY_SCAM_TRAP', 'RULE_09_BIOMETRIC_OTP_PHISHING',
  'RULE_10_FAKE_EXCHANGE_CRYPTO_CLONE', 'RULE_11_DEEPFAKE_URGENT_COERCION',
  'RULE_12_CONDITIONAL_LOAN_TERMS', 'RULE_13_INSURANCE_BUNDLING',
  'RULE_14_CHANNEL_REPUTATION', 'RULE_15_CHANNEL_RISK', 'RULE_16_TRANSFER_AMOUNT_REVIEW',
  'RULE_17_PROMPT_INJECTION_TAMPER',
])
export type RuleCode = z.infer<typeof RuleCode>

export const DtiRiskBand = z.enum(['SAFE', 'MODERATE', 'HIGH_PRESSURE', 'CRITICAL_OVERLOAD', 'UNAVAILABLE'])
export type DtiRiskBand = z.infer<typeof DtiRiskBand>

export const DataProvenance = z.enum(['CATALOG_VERIFIED', 'WEB_REFERENCE'])
export type DataProvenance = z.infer<typeof DataProvenance>

export const AuthProvider = z.enum(['EMAIL', 'GOOGLE', 'GITHUB'])
export const UserRole = z.enum(['USER', 'ADMIN'])
export const RiskAppetite = z.enum(['CONSERVATIVE', 'BALANCED', 'GROWTH'])
export const PrimaryGoal = z.enum(['BORROW_SAFE', 'OPTIMIZE_DEBT', 'SAVE_INVEST'])
export const AnalysisMode = z.enum(['GENERAL', 'PERSONALIZED'])
export const IndicatorType = z.enum(['BANK_ACCOUNT', 'PHONE', 'DOMAIN', 'KEYWORD', 'QR_PATTERN'])
export const InstitutionType = z.enum(['BANK', 'FINANCE_COMPANY', 'FUND_HOUSE', 'EWALLET'])
export const LicenseIssuer = z.enum(['NHNN', 'UBCKNN'])
export const TrustStatus = z.enum(['LICENSED', 'SUSPENDED', 'BLACKLISTED'])
export const LoanCategory = z.enum(['UNSECURED_LOAN', 'SECURED_LOAN'])
export const LoanUseCase = z.enum([
  'UNSECURED_SALARY', 'HOME_MORTGAGE', 'AUTO_LOAN', 'BUSINESS_WORKING_CAPITAL', 'CONSUMER_FLAT_INSTALLMENT',
])
export const InvestmentCategory = z.enum(['SAVING', 'ACCUMULATION', 'OPEN_FUND'])
export const ProductCategory = z.enum([...LoanCategory.options, ...InvestmentCategory.options])
export const CalcMethod = z.enum(['REDUCING_BALANCE', 'DECLINING_PRINCIPAL', 'FLAT_RATE', 'COMPOUND_DCA'])
export const RateType = z.enum(['FIXED', 'FLOATING', 'PROMO_THEN_FLOATING', 'VARIABLE_NAV'])
export const SessionMode = z.enum(['LOAN_SURVEY', 'INVESTMENT_SURVEY', 'MANUAL_COMPARE'])
export const InputChannel = z.enum(['CHAT_IMAGE', 'PDF', 'VIETQR_IMAGE', 'TEXT'])
export const FindingSeverity = z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'])
export const QrServiceCode = z.enum(['QRIBFTTA', 'QRIBFTTC', 'MERCHANT'])
export const QrScheme = z.enum(['VIETQR_NAPAS', 'EWALLET_VN', 'EMVCO_INTL', 'URL_LINK', 'CRYPTO_WALLET', 'UNKNOWN'])
export type QrScheme = z.infer<typeof QrScheme>
export const VerificationStatus = z.enum(['UNVERIFIED', 'VERIFIED'])

export type AuthProvider = z.infer<typeof AuthProvider>
export type UserRole = z.infer<typeof UserRole>
export type RiskAppetite = z.infer<typeof RiskAppetite>
export type PrimaryGoal = z.infer<typeof PrimaryGoal>
export type AnalysisMode = z.infer<typeof AnalysisMode>
export type IndicatorType = z.infer<typeof IndicatorType>
export type InstitutionType = z.infer<typeof InstitutionType>
export type LicenseIssuer = z.infer<typeof LicenseIssuer>
export type TrustStatus = z.infer<typeof TrustStatus>
export type LoanCategory = z.infer<typeof LoanCategory>
export type LoanUseCase = z.infer<typeof LoanUseCase>
export type InvestmentCategory = z.infer<typeof InvestmentCategory>
export type ProductCategory = z.infer<typeof ProductCategory>
export type CalcMethod = z.infer<typeof CalcMethod>
export type RateType = z.infer<typeof RateType>
export type SessionMode = z.infer<typeof SessionMode>
export type InputChannel = z.infer<typeof InputChannel>
export type FindingSeverity = z.infer<typeof FindingSeverity>
export type QrServiceCode = z.infer<typeof QrServiceCode>
export type VerificationStatus = z.infer<typeof VerificationStatus>
