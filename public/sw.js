// Handleliste service worker — kept deliberately small.
// - Static build files and icons: cache first (they are content-hashed, so never stale).
// - Pages: network first, falling back to the last copy seen, so the list still opens
//   with no signal in the shop.
// - Everything else (server actions are POST, API calls) goes straight to the network.
const VERSION = 'v1'
const STATIC = `static-${VERSION}`
const PAGES = `pages-${VERSION}`

// Authorization and connection management must always use the current session.
function connectorPath(path) {
  return path === '/connect' || path.startsWith('/connect/') || path.startsWith('/api/connector/')
    || path === '/mcp' || path.startsWith('/.well-known/') || path.startsWith('/innstillingar/assistentar')
}

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== STATIC && k !== PAGES).map((k) => caches.delete(k)))
    ).then(async () => {
      const cache = await caches.open(PAGES)
      const requests = await cache.keys()
      await Promise.all(requests.filter(r => connectorPath(new URL(r.url).pathname)).map(r => cache.delete(r)))
      await self.clients.claim()
    })
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (connectorPath(url.pathname)) return

  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.open(STATIC).then(async (cache) => {
        const hit = await cache.match(req)
        if (hit) return hit
        const res = await fetch(req)
        if (res.ok) cache.put(req, res.clone())
        return res
      })
    )
    return
  }

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            // Store under the final URL (after redirects, e.g. "/" → "/lister/<id>"),
            // and remember the last list page so "/" can open it offline.
            const finalUrl = res.url || req.url
            const isList = new URL(finalUrl).pathname.startsWith('/lister/')
            const a = res.clone()
            const b = isList ? res.clone() : null
            caches.open(PAGES).then((cache) => {
              cache.put(finalUrl, a)
              if (b) cache.put('/__last-list', b)
            })
          }
          return res
        })
        .catch(async () =>
          (await caches.match(req)) || (await caches.match('/__last-list')) || Response.error()
        )
    )
  }
})
