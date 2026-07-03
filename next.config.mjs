/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  images: {
    remotePatterns: [
      {
        hostname: "svgl.app",
        pathname: "/library/**",
        protocol: "https",
      },
    ],
  },
}

export default nextConfig
