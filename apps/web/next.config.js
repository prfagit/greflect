/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    // Use Docker service name in production, localhost for development
    const apiUrl = process.env.NODE_ENV === 'production' 
      ? 'http://api:4000' 
      : (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000');
    return [
      {
        source: '/api/:path*',
        destination: `${apiUrl}/:path*`,
      },
    ]
  },
}

module.exports = nextConfig
