import { json, resourceMetadata } from '@/lib/connector/security'
export const dynamic = 'force-dynamic'
export function GET() { return json(resourceMetadata(), 200, { 'Access-Control-Allow-Origin': '*' }) }
