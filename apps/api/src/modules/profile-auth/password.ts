import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

const options = { N: 32_768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }
const saltLength = 16
const keyLength = 64
const format = /^scrypt:([0-9a-f]{32}):([0-9a-f]{128})$/

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, key) => {
      if (error) reject(error)
      else resolve(key)
    })
  })
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(saltLength)
  const key = await deriveKey(password, salt)
  return `scrypt:${salt.toString('hex')}:${key.toString('hex')}`
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const parts = format.exec(stored ?? '')
  const salt = parts ? Buffer.from(parts[1], 'hex') : Buffer.alloc(saltLength)
  const expected = parts ? Buffer.from(parts[2], 'hex') : Buffer.alloc(keyLength)
  const actual = await deriveKey(password, salt)
  return timingSafeEqual(actual, expected) && parts !== null
}
