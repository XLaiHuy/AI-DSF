import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import type { ForensicAuditResponse } from '@fincopilot/shared-types'
import { buildForensicRiskAssessment } from './risk-assessment.engine'

function stixId(type: string, seed: string) {
  const bytes = createHash('sha1').update('fincopilot:stix:' + seed).digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 15) | 0x50
  bytes[8] = (bytes[8] & 63) | 0x80
  const hex = bytes.toString('hex')
  return type + '--' + [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-')
}

function publicDomain(raw: string) {
  try {
    const url = new URL(raw)
    const host = url.hostname.toLowerCase().replace(/\.$/, '')
    // Do not export paths, credentials, addresses, or labels that can encode an account or phone number.
    return /^https?:$/.test(url.protocol) && !url.username && !url.password && !isIP(host) &&
      /^(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z]{2,63}$/.test(host) &&
      !/\d(?:[.-]?\d){6}|\b(?:localhost|local|lan|internal)\b/.test(host) ? host : null
  } catch {
    return null
  }
}

export function buildStix21Bundle(audit: ForensicAuditResponse) {
  const timestamp = audit.createdAt ?? audit.privacyProof.sourceFilesPurgedAt
  const assessment = audit.riskAssessment ?? buildForensicRiskAssessment(audit)
  const stamp = { spec_version: '2.1', created: timestamp, modified: timestamp } as const
  const identity = {
    ...stamp, type: 'identity', id: stixId('identity', 'FinCopilot AI'),
    name: 'FinCopilot AI', identity_class: 'system',
  }
  const flagged = audit.findings.filter(finding => finding.matchedIndicatorId || finding.severity === 'CRITICAL')
  const domains = new Set<string>()
  function addDomain(url: string) {
    const host = publicDomain(url)
    if (host && domains.size < 24) domains.add(host)
  }
  for (const finding of flagged) {
    for (const [url] of finding.evidenceQuote.matchAll(/https?:\/\/[^\s<>"']+/giu)) addDomain(url)
  }
  for (const qr of audit.qrPayloads) {
    if (qr.targetUrl && qr.channelIntelligence?.reputationStatus === 'FLAGGED_SCAM') addDomain(qr.targetUrl)
  }

  const descriptors = audit.qrPayloads.map(qr => ({
    scheme: qr.qrScheme ?? 'UNKNOWN', crcValid: qr.crcValid, entityMismatch: qr.entityMismatchFlag,
  }))
  const observation = { qr: descriptors, institutionLicense: audit.entityLicense?.status ?? null }
  const bytes = Buffer.from(JSON.stringify(observation))
  const fingerprint = createHash('sha256').update(bytes).digest('hex')
  const artifact = descriptors.length || observation.institutionLicense ? {
    type: 'artifact', spec_version: '2.1', id: stixId('artifact', fingerprint),
    mime_type: 'application/json', payload_bin: bytes.toString('base64'), hashes: { 'SHA-256': fingerprint },
  } : null
  const observed = artifact ? {
    ...stamp, id: stixId('observed-data', audit.auditId), type: 'observed-data', created_by_ref: identity.id,
    first_observed: timestamp, last_observed: timestamp, number_observed: 1, object_refs: [artifact.id],
  } : null
  const indicators = [...domains].map(domain => ({
    ...stamp, type: 'indicator', id: stixId('indicator', audit.auditId + ':' + domain), created_by_ref: identity.id,
    name: 'Tên miền cần đối chiếu', indicator_types: ['anomalous-activity'],
    pattern: "[domain-name:value = '" + domain + "']", pattern_type: 'stix', pattern_version: '2.1', valid_from: timestamp,
  }))
  const report = {
    ...stamp, type: 'report', id: stixId('report', audit.auditId), created_by_ref: identity.id,
    name: 'Hồ sơ giám định FinCopilot', report_types: ['threat-report'], published: timestamp,
    object_refs: [identity.id, ...indicators.map(indicator => indicator.id), ...(observed ? [observed.id] : [])],
    x_fincopilot_assessment: {
      standard: 'FERS-v1', tier: assessment.riskTier, confidence: assessment.evidenceConfidence,
      taxonomy: assessment.taxonomy.map(item => ({ vn_ais: item.vnAisCode, gasa: item.gasaCategory })),
    },
  }
  return {
    type: 'bundle', id: stixId('bundle', audit.auditId), spec_version: '2.1',
    objects: [identity, ...indicators, ...(artifact && observed ? [artifact, observed] : []), report],
  }
}
