import { exchangeToken, rateLimit } from '@/lib/connector/auth'
import { bodyText, ConnectorError, errorResponse, json } from '@/lib/connector/security'
export const runtime = 'nodejs'
export async function POST(request: Request) {
  try {
    await rateLimit(`token:${request.headers.get('x-vercel-forwarded-for') || request.headers.get('x-forwarded-for') || 'unknown'}`, 200, 3600)
    if (!request.headers.get('content-type')?.includes('application/x-www-form-urlencoded')) throw new ConnectorError('invalid_request', 'Use form encoding')
    const params = new URLSearchParams(await bodyText(request, 12000))
    for (const key of [...new Set(params.keys())]) if (params.getAll(key).length > 1) throw new ConnectorError('invalid_request', 'Repeated parameter')
    return json(await exchangeToken(request, params))
  } catch (error) { return errorResponse(error) }
}
