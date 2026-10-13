const VPS_TARGET = process.env.NEXT_PUBLIC_VPS_API_URL?.trim().replace(/\/$/, "") || "http://127.0.0.1:28129";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  agentRules: false,
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${VPS_TARGET}/api/v1/:path*`,
      },
    ];
  },
  allowedDevOrigins: [
    "172.26.64.1",
    "172.26.64.1:3000",
    "172.26.64.1:3001",
    "172.16.64.3",
    "172.16.64.3:3000",
    "172.16.64.3:3001",
    "localhost",
    "localhost:3000",
    "localhost:3001"
  ],
};

export default nextConfig;
