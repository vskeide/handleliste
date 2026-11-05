import { createHmac, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { SESSION_COOKIE_NAME, SESSION_MAX_AGE } from '@/lib/constants'

// The session cookie is "<householdId>.<hmac>". The HMAC proves the server issued it,
// so knowing a household id is no longer enough to log in as that household.
// SESSION_SECRET is optional: without it the service-role key is used as the secret,
// which means rotating that key logs everyone out (acceptable for this app).
function secret(): string {
  const s = process.env.SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!s) throw new Error('SESSION_SECRET or SUPABASE_SERVICE_ROLE_KEY must be set')
  return s
}

function sign(householdId: string): string {
  return createHmac('sha256', secret()).update(`household:${householdId}`).digest('base64url')
}

export function encodeSession(householdId: string): string {
  return `${householdId}.${sign(householdId)}`
}

export function decodeSession(value: string | undefined | null): string | null {
  if (!value) return null
  const dot = value.lastIndexOf('.')
  if (dot <= 0) return null
  const id = value.slice(0, dot)
  const given = Buffer.from(value.slice(dot + 1))
  const expected = Buffer.from(sign(id))
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  return id
}

/** The logged-in household id, or null. Use this everywhere instead of reading the cookie. */
export async function readSession(): Promise<string | null> {
  return decodeSession((await cookies()).get(SESSION_COOKIE_NAME)?.value)
}

/** For server pages behind login: the household id, or redirect to the welcome page. */
export async function requireSession(): Promise<string> {
  const id = await readSession()
  if (!id) redirect('/')
  return id
}

export async function writeSession(householdId: string) {
  (await cookies()).set(SESSION_COOKIE_NAME, encodeSession(householdId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE,
    path: '/',
  })
}

export async function clearSession() {
  (await cookies()).set(SESSION_COOKIE_NAME, '', { maxAge: 0, path: '/' })
}
