import { randomUUID } from 'node:crypto'
import { Injectable, type OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'

const MAX_KEYS = 2_000
type LocalEntry = { expiresAt: number; value: string | number[] }

const slidingWindow = `
local now = redis.call('TIME')
local millis = now[1] * 1000 + math.floor(now[2] / 1000)
local window = tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', millis - window)
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[1]) then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  return math.max(1, math.ceil((tonumber(oldest[2]) + window - millis) / 1000))
end
redis.call('ZADD', KEYS[1], millis, ARGV[3])
redis.call('PEXPIRE', KEYS[1], window)
return 0`

const writeOpenSession = `
if redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
local current = redis.call('GET', KEYS[1]) or ''
if current ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
return 1`

const closeSession = `
redis.call('SET', KEYS[2], '1', 'EX', ARGV[1])
redis.call('DEL', KEYS[1])
return 1`

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client?: Redis
  private readonly local = new Map<string, LocalEntry>()

  constructor(config: ConfigService) {
    const url = config.get<string>('REDIS_URL')?.trim()
    if (!url && process.env.NODE_ENV === 'test') return
    this.client = new Redis(url || config.getOrThrow<string>('REDIS_URL'), {
      lazyConnect: true,
      connectTimeout: 1_500,
      commandTimeout: 1_500,
      maxRetriesPerRequest: 0,
    })
    this.client.on('error', () => {
      // Callers handle unavailability without logging connection details.
    })
  }

  ping() {
    return this.client?.ping() ?? Promise.resolve('PONG')
  }

  async get(key: string) {
    if (this.client) return this.client.get(key)
    const value = this.localValue(key)
    return typeof value === 'string' ? value : null
  }

  async getJson<T>(key: string): Promise<T | null> {
    try {
      const value = await this.get(key)
      return value === null ? null : JSON.parse(value) as T
    } catch {
      return null
    }
  }

  async setJson(key: string, value: unknown, ttlSeconds: number) {
    try {
      const raw = JSON.stringify(value)
      if (raw === undefined) return
      if (this.client) await this.client.set(key, raw, 'EX', ttlSeconds)
      else this.setLocal(key, raw, ttlSeconds * 1_000)
    } catch {
      // Public reads remain available when the cache is down.
    }
  }

  async del(key: string) {
    try {
      if (this.client) await this.client.del(key)
      else this.local.delete(key)
    } catch {
      // Public entries also expire by TTL.
    }
  }

  async saveOpenSession(key: string, expected: string | null, value: string, ttl: number) {
    const closed = key + ':closed'
    if (this.client) {
      return await this.client.eval(writeOpenSession, 2, key, closed, expected ?? '', value, ttl) === 1
    }
    if (this.localValue(closed) || (this.localValue(key) ?? null) !== expected) return false
    this.setLocal(key, value, ttl * 1_000)
    return true
  }

  async closeSession(key: string, ttl: number) {
    const closed = key + ':closed'
    if (this.client) {
      await this.client.eval(closeSession, 2, key, closed, ttl)
      return
    }
    this.local.delete(key)
    this.setLocal(closed, '1', ttl * 1_000)
  }

  async retryAfter(key: string, limit: number, windowMs: number) {
    if (this.client) {
      const retry = await this.client.eval(slidingWindow, 1, key, limit, windowMs, randomUUID())
      if (typeof retry !== 'number') throw new Error('Invalid rate-limit response')
      return retry
    }
    const now = Date.now()
    const value = this.localValue(key)
    const timestamps = Array.isArray(value) ? value.filter(time => time > now - windowMs) : []
    if (timestamps.length >= limit) return Math.max(1, Math.ceil((timestamps[0] + windowMs - now) / 1_000))
    this.setLocal(key, [...timestamps, now], windowMs)
    return 0
  }

  private localValue(key: string) {
    const entry = this.local.get(key)
    if (!entry) return undefined
    if (entry.expiresAt > Date.now()) return entry.value
    this.local.delete(key)
  }

  private setLocal(key: string, value: LocalEntry['value'], ttlMs: number) {
    if (this.local.size >= MAX_KEYS && !this.local.has(key)) {
      const now = Date.now()
      for (const [entryKey, entry] of this.local) {
        if (entry.expiresAt <= now) this.local.delete(entryKey)
      }
      if (this.local.size >= MAX_KEYS) throw new Error('Test Redis capacity reached')
    }
    this.local.set(key, { value, expiresAt: Date.now() + ttlMs })
  }

  onModuleDestroy() {
    this.client?.disconnect()
    this.local.clear()
  }
}
