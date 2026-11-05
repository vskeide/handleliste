/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [{ source: '/connect/:path*', headers: [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'Cache-Control', value: 'no-store' },
    ] }, { source: '/api/connector/:path*', headers: [
      { key: 'Access-Control-Allow-Origin', value: '*' },
      { key: 'Access-Control-Allow-Methods', value: 'POST, OPTIONS' },
      { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization' },
      { key: 'Cache-Control', value: 'no-store' },
    ] }]
  },
}

module.exports = nextConfig
