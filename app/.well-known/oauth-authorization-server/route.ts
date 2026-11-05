import { authorizationMetadata, json } from '@/lib/connector/security'
export const dynamic = 'force-dynamic'
export function GET() { return json(authorizationMetadata(), 200, { 'Access-Control-Allow-Origin': '*' }) }
