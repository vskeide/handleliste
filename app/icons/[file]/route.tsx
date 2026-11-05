import { ImageResponse } from 'next/og'

// App icons drawn in code, so no binary files live in the repo.
// Serves /icons/icon-192.png, /icons/icon-512.png, /icons/maskable-512.png, /icons/apple-180.png
const SIZES: Record<string, { size: number; maskable: boolean }> = {
  'icon-192.png': { size: 192, maskable: false },
  'icon-512.png': { size: 512, maskable: false },
  'maskable-512.png': { size: 512, maskable: true },
  'apple-180.png': { size: 180, maskable: true },
}

// Rendered on request at the edge (and cached a week by the browser and CDN).
// Pre-rendering at build time fails on Windows with next/og ("Invalid URL").
export const runtime = 'edge'

export function GET(_req: Request, { params }: { params: { file: string } }) {
  const spec = SIZES[params.file]
  if (!spec) return new Response('Not found', { status: 404 })
  const { size, maskable } = spec
  // Maskable icons need the artwork inside the central 80 % "safe zone"
  const glyph = Math.round(size * (maskable ? 0.5 : 0.62))
  const radius = maskable ? 0 : Math.round(size * 0.22)

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#3B82F6',
          borderRadius: radius,
        }}
      >
        {/* Shopping cart, drawn as SVG */}
        <svg width={glyph} height={glyph} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="8" cy="21" r="1" />
          <circle cx="19" cy="21" r="1" />
          <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
        </svg>
      </div>
    ),
    { width: size, height: size, headers: { 'Cache-Control': 'public, max-age=604800, immutable' } },
  )
}
