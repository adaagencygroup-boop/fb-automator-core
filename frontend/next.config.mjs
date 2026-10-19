/** @type {import('next').NextConfig} */
const nextConfig = {
  // The build helper opts in without rewriting this watched config file.
  ...(process.env.FRONTEND_BUILD_WORKER_THREADS === "1"
    ? { experimental: { workerThreads: true, cpus: 2 } }
    : {}),
  output: "export",
  images: {
    unoptimized: true,
  },
  trailingSlash: true,
};

export default nextConfig;
