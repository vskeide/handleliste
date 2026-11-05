import { bearerConnection, rateLimit } from '@/lib/connector/auth'
import { callTool, INSTRUCTIONS, TOOLS } from '@/lib/connector/tools'
import { bodyText, ConnectorError, errorResponse, json, origin } from '@/lib/connector/security'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']
function challenge() { return `Bearer resource_metadata="${origin()}/.well-known/oauth-protected-resource/mcp"` }
function originAllowed(request: Request) {
  const value = request.headers.get('origin')
  return !value || [origin(), 'https://chatgpt.com', 'https://chat.openai.com', 'https://claude.ai'].includes(value)
}
function cors(request: Request): Record<string, string> {
  const value = request.headers.get('origin')
  return value && originAllowed(request) ? { 'Access-Control-Allow-Origin': value, Vary: 'Origin', 'Access-Control-Expose-Headers': 'WWW-Authenticate, MCP-Protocol-Version' } : {}
}
export function OPTIONS(request: Request) {
  if (!originAllowed(request)) return json({ error: 'Forbidden origin' }, 403)
  return new Response(null, { status: 204, headers: { ...cors(request), 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version, Mcp-Session-Id', 'Access-Control-Max-Age': '600' } })
}
export async function GET(request: Request) {
  try {
    if (!originAllowed(request)) return json({ error: 'Forbidden origin' }, 403)
    if (!(await bearerConnection(request))) return json({ error: 'unauthorized' }, 401, { ...cors(request), 'WWW-Authenticate': challenge() })
    // Stateless JSON responses: no server-initiated SSE stream is required.
    return new Response(null, { status: 405, headers: { Allow: 'POST, OPTIONS', ...cors(request) } })
  } catch (error) { return errorResponse(error) }
}
export async function POST(request: Request) {
  if (!originAllowed(request)) return json({ error: 'Forbidden origin' }, 403)
  const headers = cors(request)
  try {
    const connection = await bearerConnection(request)
    if (!connection) return json({ error: 'unauthorized' }, 401, { ...headers, 'WWW-Authenticate': challenge() })
    await rateLimit(`mcp:${connection.id}`, 120, 60)
    if (!request.headers.get('content-type')?.includes('application/json')) return json({ error: 'Use application/json' }, 415, headers)
    const version = request.headers.get('mcp-protocol-version')
    if (version && !VERSIONS.includes(version)) return json({ error: 'Unsupported MCP protocol version' }, 400, headers)
    let message
    try { message = JSON.parse(await bodyText(request)) } catch (e) {
      if (e instanceof ConnectorError) throw e
      return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400, headers)
    }
    if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string' || (message.id !== undefined && typeof message.id !== 'string' && typeof message.id !== 'number')) {
      return json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } }, 400, headers)
    }
    if (message.id === undefined) return new Response(null, { status: 202, headers })
    const respond = (result: unknown) => json({ jsonrpc: '2.0', id: message.id, result }, 200, headers)
    if (message.method === 'initialize') return respond({ protocolVersion: VERSIONS.includes(message.params?.protocolVersion) ? message.params.protocolVersion : VERSIONS[0],
      capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'handleliste', version: '1.0.0' }, instructions: INSTRUCTIONS })
    if (message.method === 'ping') return respond({})
    if (message.method === 'tools/list') return respond({ tools: TOOLS.filter(tool => tool.securitySchemes[0].scopes.every(s => connection.scope.split(' ').includes(s))) })
    if (message.method === 'tools/call') {
      try {
        const result = await callTool(message.params?.name, message.params?.arguments ?? {}, connection)
        return respond({ content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result })
      } catch (error) {
        const known = error instanceof ConnectorError
        return respond({ isError: true, content: [{ type: 'text', text: known ? error.message : 'Temporarily unavailable. Retry with the same request_id.' }],
          ...(known && error.code === 'insufficient_scope' ? { _meta: { 'mcp/www_authenticate': [`${challenge()}, error="insufficient_scope", scope="${error.scope}"`] } } : {}) })
      }
    }
    return json({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } }, 200, headers)
  } catch (error) { return errorResponse(error) }
}
