import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const rootPkg = require(path.resolve(__dirname, "../package.json"));

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    // "Phiên bản X.Y.Z" trên login — đổi version ở root package.json khi release
    NEXT_PUBLIC_APP_VERSION: String(rootPkg.version || "0.0.0"),
  },
  experimental: {
    agentUpgrade: "security",
    ...(process.env.FRONTEND_BUILD_WORKER_THREADS === "1"
      ? { workerThreads: true, cpus: 2 }
      : {}),
  },
  output: "export",
  outputFileTracingRoot: path.resolve(__dirname, "./"),
  images: {
    unoptimized: true,
  },
  trailingSlash: true,
};

export default nextConfig;
