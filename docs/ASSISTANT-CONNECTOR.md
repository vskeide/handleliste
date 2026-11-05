# ChatGPT and Claude connector

Handleliste exposes one authenticated remote MCP endpoint at:

`https://handleliste-nine.vercel.app/mcp`

The assistant does the reasoning using the user's ChatGPT/Claude subscription.
Handleliste only validates and executes shopping/meal commands. There are no OpenAI
or Anthropic model API calls, API keys or model charges in this implementation.
Existing Vercel/Supabase hosting usage still applies.

## Connect once in each app

Deploy the app changes before adding the connector. Migration 0007 is already applied.

**ChatGPT:** open Plugins, choose the plus button and Add custom MCP server. Name it
Handleliste and enter the endpoint above. Use OAuth/sign-in when asked. Follow the
Handleliste sign-in page, then approve the displayed permissions. Install/select the
plugin in the chat where you want to use it.

**Claude:** open Plugins/Connectors (the label depends on the rollout), add a custom
connector and enter the same endpoint. Choose sign-in and Claude's published identity;
automatic registration also works. Complete the Handleliste sign-in and approval.
Enable the connector in the conversation.

Both apps keep separate revocable credentials. Manage them in Handleliste under
**Innstillingar → ChatGPT og Claude**. Revoking one connection immediately disables its
access and refresh tokens. The household PIN is entered only on Handleliste's page.
Access tokens expire after one hour; refresh credentials rotate and have a 90-day
absolute lifetime, after which the user reconnects.

Example requests:

- “Vis handlelistene mine.”
- “Legg 2 L mjølk og 6 egg i Vekohandel.”
- “Lagre denne oppskrifta som ein middag for fire personar.”
- “Lagre denne middagen og legg ingrediensane i Storhandel.”
- “Legg den lagra middagen Taco i Vekohandel for seks personar.”

For a recipe URL/photo or a recipe discussed in chat, the assistant reads the source
and supplies structured ingredients. The server does not browse arbitrary links.
Source URL and optional instructions are saved with the meal and shown in Middagar.
If the source is inaccessible, paste the ingredients into the assistant. Do not assume
custom tools work in every mobile/voice mode; check the selected client surface.

## Tools and list selection

| Tool | Purpose |
|---|---|
| `list_lists` | Return this household's shopping lists and exact IDs |
| `get_list` | Read one selected list and its checked/unchecked items |
| `list_meals` | Return saved meals, IDs, servings and ingredient counts |
| `add_items` | Add/merge ingredients into an explicit `list_id` |
| `save_meal` | Save ingredients/servings/source/instructions; optionally also add to an explicit list |
| `add_meal_to_list` | Add a saved meal to an explicit list, scaled to household or requested portions |

List writes always require an exact list ID. Instructions tell the assistant to look
up names and ask when the destination is missing or ambiguous. There is no silent
“first list” fallback. Saving a meal alone does not change a shopping list.

Every write requires a `request_id`. Retries with unchanged arguments and the same
connection return the original result. Reusing a request ID with different arguments
is refused. A genuinely new user action requires a new ID. Receipts are retained;
do not prune them without defining an expiry policy for retried requests.

`save_meal` quantities describe the original recipe servings. Saving and adding can
scale the shopping quantities without changing the saved recipe. Compatible units
merge through the same transactional path used by the shopping UI. Incompatible
units are reported as unchanged; they are never silently converted into pieces.

## Authentication and implementation

- Stateless Streamable HTTP MCP, JSON responses, no long-lived process or SSE session.
- OAuth authorization-code flow with PKCE S256; no implicit/password grant.
- Protected resource and authorization-server discovery, issuer response identification.
- Dynamic registration for public/secret clients, plus published client identity
  documents (CIMD) for ChatGPT and Claude. Published metadata/JWKS can only be fetched
  from the exact provider domains over HTTPS, without redirects, credentials or
  query strings. Responses are bounded and cached briefly.
- Public-client auth, client-secret post/basic, and RSA `private_key_jwt` for published
  identities. Signed assertions verify issuer, subject, audience, expiry and signature;
  a rate-limit bucket enforces one-use assertion IDs.
- Opaque access/refresh tokens: only SHA-256 hashes are persisted. Authorization codes
  are single-use, short-lived, hashed and bound to client, redirect, PKCE and resource.
- Granted permissions: `lists:read`, `lists:write`, `meals:write`. Save-and-add checks
  both relevant write permissions. Tokens are checked for revocation/expiry on every
  MCP request; browser cookies are not accepted as MCP credentials.
- Request-size limits, strict tool argument validation, origin checks, endpoint rate
  limits and a daily global registration cap. Consent pages deny framing and suppress
  referrers. Client names/recipe instructions are rendered as text.
- New tables/functions are server-role-only, RLS enabled, no anon/authenticated access.
- `connector_write` serializes household writes and saves its receipt in the same
  transaction as recipe/list mutations. It reuses `apply_list_operation` from 0006.
  A content-free broadcast nudges phones to refresh; polling is the fallback.

No existing model SDK, external identity service or additional hosting service is
needed. The connector uses the app's existing session/PIN sign-in. Authenticated
members of a household can revoke that household's connections.

`CONNECTOR_ORIGIN` is optional and defaults to the production URL above. For another
deployment/domain it must be the exact public HTTPS origin before building/deploying;
discovery, issuer, resource and callbacks must describe the same deployment. Never
derive it from an untrusted Host header. HTTP origins are accepted only in local
development. Preview deployments must not accidentally advertise production auth
URLs when testing a real client against the preview.

## Verification and remaining release steps

- `npm test`: 38 regression/unit tests pass (14 connector-specific), including PKCE vectors, restricted URLs,
  published-client RSA signatures/claims, permission boundaries, strict inputs and scaling.
  Connector authorization/management pages bypass the service-worker cache; activation
  removes previously cached connector pages without deleting offline shopping lists.
- `node --env-file=.env.local scripts/check-connector.mjs`: 10 HTTP integration groups
  pass against a local preview. They exercise the real consent form/server action,
  registration, PKCE failures, one-use codes, MCP initialization/tools, both providers'
  actual public metadata, household isolation, selected-list writes, recipe saving/
  scaling, idempotent replay, changed-payload rejection, scopes, expiry, refresh rotation,
  revocation and hashed storage. Isolated test households/clients are removed afterward.
- The script only targets localhost and never follows external OAuth callbacks or
  prints credentials. It needs the existing service-role environment to create/remove
  its own disposable fixtures. No real household is used.
- TypeScript, production build and Nynorsk UI check pass. Migration 0007 was applied;
  the security advisor reports only expected RLS-without-policy informational notices.
- New tests left zero test households and zero test client records in Supabase.
- Browser automation was unavailable in this side chat (kernel asset error). HTTP
  tests verify the actual rendered consent form and its submission, but visual QA
  and actual account linking in ChatGPT/Claude are not claimed complete.

After pushing/deploying, verify the public discovery/401 challenge, then connect the
user's real accounts and run one list read, one item add, one save-meal and one
add-meal-to-selected-list through each assistant. User account sign-in/consent is a
required final setup step; it cannot be substituted by a protocol test. The integration
tests establish the backend flow, not a guarantee about every assistant UI/voice mode.

References: [ChatGPT MCP authentication](https://developers.openai.com/plugins/build/auth),
[ChatGPT custom servers](https://developers.openai.com/api/docs/guides/custom-mcp-server),
[Claude custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp),
[MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization).
