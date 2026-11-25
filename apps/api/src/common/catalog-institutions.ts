type InstitutionSeed = {
  code: string; name: string; institutionType: string; licenseIssuer: string; vietqrBin: string | null; officialWebsite: string
}

export const catalogInstitutions: InstitutionSeed[] = [
  { code: 'VCB', name: 'Vietcombank', institutionType: 'BANK', licenseIssuer: 'NHNN', vietqrBin: '970436', officialWebsite: 'https://www.vietcombank.com.vn/' },
  { code: 'BIDV', name: 'BIDV', institutionType: 'BANK', licenseIssuer: 'NHNN', vietqrBin: '970418', officialWebsite: 'https://www.bidv.com.vn/' },
  { code: 'CTG', name: 'VietinBank', institutionType: 'BANK', licenseIssuer: 'NHNN', vietqrBin: '970415', officialWebsite: 'https://www.vietinbank.vn/' },
  { code: 'AGR', name: 'Agribank', institutionType: 'BANK', licenseIssuer: 'NHNN', vietqrBin: '970405', officialWebsite: 'https://www.agribank.com.vn/' },
  { code: 'TCB', name: 'Techcombank', institutionType: 'BANK', licenseIssuer: 'NHNN', vietqrBin: '970407', officialWebsite: 'https://www.techcombank.com.vn/' },
  { code: 'MBB', name: 'MBBank', institutionType: 'BANK', licenseIssuer: 'NHNN', vietqrBin: '970422', officialWebsite: 'https://www.mbbank.com.vn/' },
  { code: 'ACB', name: 'ACB', institutionType: 'BANK', licenseIssuer: 'NHNN', vietqrBin: '970416', officialWebsite: 'https://www.acb.com.vn/' },
  { code: 'VPB', name: 'VPBank', institutionType: 'BANK', licenseIssuer: 'NHNN', vietqrBin: '970432', officialWebsite: 'https://www.vpbank.com.vn/' },
  { code: 'TPB', name: 'TPBank', institutionType: 'BANK', licenseIssuer: 'NHNN', vietqrBin: '970423', officialWebsite: 'https://tpb.vn/' },
  { code: 'VIB', name: 'VIB', institutionType: 'BANK', licenseIssuer: 'NHNN', vietqrBin: '970441', officialWebsite: 'https://www.vib.com.vn/' },
  { code: 'FEC', name: 'FE Credit', institutionType: 'FINANCE_COMPANY', licenseIssuer: 'NHNN', vietqrBin: null, officialWebsite: 'https://www.fecredit.com.vn/' },
  { code: 'HMC', name: 'Home Credit Việt Nam', institutionType: 'FINANCE_COMPANY', licenseIssuer: 'NHNN', vietqrBin: null, officialWebsite: 'https://www.homecredit.vn/' },
  { code: 'MCR', name: 'Mcredit (MB Shinsei)', institutionType: 'FINANCE_COMPANY', licenseIssuer: 'NHNN', vietqrBin: null, officialWebsite: 'https://www.mcredit.com.vn/' },
  { code: 'HDS', name: 'HD SAISON', institutionType: 'FINANCE_COMPANY', licenseIssuer: 'NHNN', vietqrBin: null, officialWebsite: 'https://www.hdsaison.com.vn/' },
  { code: 'MOMO_TTT', name: 'Ví / Túi Thần Tài (đối tác tích lũy)', institutionType: 'EWALLET', licenseIssuer: 'NHNN', vietqrBin: null, officialWebsite: 'https://www.momo.vn/' },
  { code: 'VCBF', name: 'Quỹ mở VCBF', institutionType: 'FUND_HOUSE', licenseIssuer: 'UBCKNN', vietqrBin: null, officialWebsite: 'https://www.vcbf.com/' },
  { code: 'VINA', name: 'VinaCapital', institutionType: 'FUND_HOUSE', licenseIssuer: 'UBCKNN', vietqrBin: null, officialWebsite: 'https://vinacapital.com/' },
  { code: 'DCVFM', name: 'Dragon Capital Việt Nam', institutionType: 'FUND_HOUSE', licenseIssuer: 'UBCKNN', vietqrBin: null, officialWebsite: 'https://www.dragoncapital.com.vn/' },
]

export function isCatalogSource(institution: InstitutionSeed, url: URL) {
  const primary = new URL(institution.officialWebsite).hostname.replace(/^www\./, '')
  const domains = institution.code === 'TCB' ? [primary, 'techcombank.com'] : [primary]
  return domains.some((domain) => url.hostname === domain || url.hostname.endsWith('.' + domain))
}
