import { setTimeout as pause } from 'node:timers/promises'
import type { ForensicFollowUpResponse } from '@fincopilot/shared-types'
import type { AiGatewayService } from '../ai-gateway/ai-gateway.service'
import { normalizeVietnamese } from './data/trusted-institutions'
import type { prepareFollowUp } from './forensic-follow-up'
import { maskForensicText } from './qr-evidence'

type Event = { delta: string } | { done: true; meta: ForensicFollowUpResponse['meta'] }
const riskyAdvice = new RegExp([
  /\b(?:an toan|yen tam|dang tin(?: cay)?|tin cay|hop phap|bo qua canh bao)\b/,
  /\b(?:(?:chuyen|gui|nap|tra) (?:khoan |so )?tien|chuyen khoan|thanh toan|dong phi(?: giai ngan)?|giai ngan|quyet dinh chuyen|(?:thuc hien|tiep tuc|xac nhan|hoan tat) giao dich)\b/,
  /\b(?:quet (?:ngay|ma|qr)|(?:bam|nhap|mo|truy cap|theo) (?:vao )?(?:link|lien ket|duong dan)|(?:cai|tai) (?:dat |ve )?(?:app|ung dung))\b/,
  /\b(?:cung cap|chia se|gui|nhap) (?:ma )?(?:otp|mat khau|cccd)\b/,
].map((pattern) => pattern.source).join('|'), 'g')
const falseReassurance = /\b(?:khong (?:(?:(?:co|phat hien|thay) )?(?:bat ky |dau hieu )?rui ro|dang lo|(?:phai(?: la)?|co dau hieu) lua dao)|(?:no|zero) (?:significant )?risk|risk free|safe to (?:pay|transfer))\b/
const negation = /\b(?:(?:tuyet doi )?khong(?: nen| duoc| can(?: phai)?| phai(?: la)?)?|tranh|ngung) $/
const coordinatedAdvice = /^ (?:hay|hoac|va) $/
const transferAction = /^(?:(?:chuyen|gui|nap|tra) (?:khoan |so )?tien|chuyen khoan|thanh toan|dong phi(?: giai ngan)?|giai ngan|quyet dinh chuyen|(?:thuc hien|tiep tuc|xac nhan|hoan tat) giao dich)$/
const safeTransferPrefix = /\b(?:(?:truoc |sau )?khi(?: ban)?(?: da| chua| dinh| muon| sap| dang| can nhac| thuc hien)?|neu(?: ban)?(?: da| chua| dinh| muon| sap| dang| can nhac)?|trong truong hop|neu co y dinh|khoan|so tien|giao dich|yeu cau|lenh|thong tin|muc dich|noi dung|viec|hanh vi|dau hieu|rui ro) $/
const safeThresholdPrefix = /\b(?:muc|nguong|ty le|han muc|quy|gioi han|vuot|vuot xa|duoi|chi so) (?:tra gop |tai chinh |chi tieu |muc )?$/
const encouragingCue = /\b(?:cu|vui long|nen|co the|hay|dung) $/
const internalText = /untrusted[\s_-]*data\b|du lieu nguoi dung va tai lieu chi la bang chung|\bsystem prompt\b/
const markup = /(?:<|&lt;|&#(?:60|x3c);)\s*\/?\s*[a-z][a-z0-9:-]*(?=[\s/>]|&gt;|&#(?:62|x3e);|$)|<!--/i
const generatedCode = /<!doctype\b|document\.getElementById\b|requestAnimationFrame\b|\b(?:function|const|let|var)\s+[a-z_$][\w$]*\s*[=(]|\bdef\s+\w+\s*\(/i
const leaksInternalText = (text: string) => /\x60{3}/.test(text) || generatedCode.test(text) || markup.test(text) || internalText.test(normalizeVietnamese(text))

function hasRiskyAdvice(sentence: string) {
  // Preserve the distinction between đừng/dừng and dùng, and between hay and hãy.
  const clauses = sentence.replace(/[*_`~]/g, '')
    .replace(/(?<!\p{L})(?:đừng|dừng)(?!\p{L})/giu, 'ngừng')
    .replace(/(?<!\p{L})hãy(?!\p{L})/giu, 'vui lòng')
    .split(/[,;:.!?。！？\n—–]/u).map(normalizeVietnamese).filter(Boolean)
  const plain = clauses.join(' ')
  if (falseReassurance.test(plain)) return true

  let clause = 0
  let clauseStart = 0
  let clauseEnd = clauses[0]?.length ?? 0
  let previousNegatedEnd = -1
  let previousSafeEnd = -1
  for (const match of plain.matchAll(riskyAdvice)) {
    while (match.index >= clauseEnd) {
      clauseStart = clauseEnd + 1
      clauseEnd = clauseStart + clauses[++clause]!.length
    }
    const end = match.index + match[0].length
    // Punctuation ends a negation's scope without hiding a split risky phrase.
    if (end > clauseEnd) return true
    const prefix = plain.slice(clauseStart, match.index)
    const cue = negation.exec(prefix)
    const safeContext = !cue && !encouragingCue.test(prefix) && (
      (transferAction.test(match[0]) && safeTransferPrefix.test(prefix))
      || (match[0] === 'an toan' && safeThresholdPrefix.test(prefix))
    )
    const coordinatedNegation = !cue && !safeContext && previousNegatedEnd >= clauseStart
      && coordinatedAdvice.test(plain.slice(previousNegatedEnd, match.index))
    const coordinatedSafe = !cue && !safeContext && previousSafeEnd >= clauseStart
      && coordinatedAdvice.test(plain.slice(previousSafeEnd, match.index)) && transferAction.test(match[0])
    if (cue) {
      if (negation.test(prefix.slice(0, cue.index))) return true
      previousNegatedEnd = end
    } else if (safeContext || coordinatedSafe) {
      previousSafeEnd = end
    } else if (coordinatedNegation) {
      previousNegatedEnd = end
    } else {
      return true
    }
  }
  return false
}

export function screened(sentence: string, guarded: boolean) {
  const text = maskForensicText(sentence.normalize('NFKC').replace(/\p{Cf}/gu, '')).trim()
  if (!text) return ''
  if (leaksInternalText(text)) return ''
  if (guarded && (/(?:https?:|www\.)/i.test(text) || hasRiskyAdvice(text))) return ''
  return text
}

async function* deltas(text: string, signal: AbortSignal) {
  const words = text.match(/\S+\s*|^\s+/gu) ?? []
  for (let index = 0; index < words.length; index += 2) {
    signal.throwIfAborted()
    yield { delta: words.slice(index, index + 2).join('') }
    if (index + 2 < words.length) await pause(28, undefined, { signal })
  }
}

export async function* followUpEvents(
  ai: AiGatewayService, reply: ReturnType<typeof prepareFollowUp>, signal: AbortSignal,
): AsyncGenerator<Event> {
  if (signal.aborted) return
  if (reply.directAnswer) {
    yield* deltas(reply.directAnswer, signal)
    yield { done: true, meta: { llmProvider: null, degradedMode: false, ...reply.meta } }
    return
  }
  if (reply.prefix) {
    if (reply.meta.intent === 'NEW_CONTEXT') yield* deltas(reply.prefix + '\n\n', signal)
    else yield { delta: reply.prefix + '\n\n' }
  }
  const providerSignal = AbortSignal.any([signal, AbortSignal.timeout(48_000)])
  let pending = ''
  let received = 0
  let sent = false
  let blocked = false
  let leaked = false
  let provider: string | null = null

  const release = async function* (sentence: string) {
    if (!sentence.trim()) return
    if (leaksInternalText(sentence.normalize('NFKC').replace(/\p{Cf}/gu, ''))) leaked = true
    if (leaked) { blocked = true; return }
    const safe = screened(sentence, reply.guard)
    if (!safe) { blocked = true; return }
    yield* deltas((sent ? ' ' : '') + safe, signal)
    sent = true
  }

  try {
    for await (const chunk of ai.streamWithProvider('FORENSIC_VERDICT_NARRATIVE', reply.modelInput, providerSignal)) {
      provider = chunk.provider
      received += chunk.delta.length
      if (received > 6000) throw new Error('Reply too long')
      pending += chunk.delta
      // Keep punctuation and whitespace received in later chunks before considering a sentence complete.
      const sentences = pending.split(/(?<=[.!?。！？])(?=\s)/u)
      pending = sentences.pop() ?? ''
      for (const sentence of sentences) yield* release(sentence)
      if (leaked) break
    }
    yield* release(pending)
  } catch {
    provider = null
  }

  if (signal.aborted) return
  const degradedMode = !provider || !sent || blocked
  if (degradedMode) yield* deltas((sent ? '\n\n' : '') + reply.fallback, signal)
  yield { done: true, meta: { llmProvider: sent ? provider : null, degradedMode, ...reply.meta } }
}
