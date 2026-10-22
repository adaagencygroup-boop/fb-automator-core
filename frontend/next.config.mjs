import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The build helper opts in without rewriting this watched config file.
  ...(process.env.FRONTEND_BUILD_WORKER_THREADS === "1"
    ? { experimental: { workerThreads: true, cpus: 2 } }
    : {}),
  output: "export",
  outputFileTracingRoot: path.resolve(__dirname, "./"),
  images: {
    unoptimized: true,
  },
  trailingSlash: true,
};

export default nextConfig;
