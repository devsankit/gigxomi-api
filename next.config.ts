import type { NextConfig } from "next";

const buildCpuCount = Number.parseInt(process.env.NEXT_BUILD_CPUS ?? "", 10);

const nextConfig: NextConfig = {
  ...(Number.isInteger(buildCpuCount) && buildCpuCount > 0
    ? { experimental: { cpus: buildCpuCount } }
    : {}),
  distDir: process.env.NEXT_DIST_DIR?.trim() || ".next",
  typescript: {
    ignoreBuildErrors: true,
  },
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          {
            key: "Access-Control-Allow-Origin",
            value: "*",
          },
          {
            key: "Access-Control-Allow-Methods",
            value: "GET,POST,PUT,PATCH,DELETE,OPTIONS",
          },
          {
            key: "Access-Control-Allow-Headers",
            value: "Authorization, Content-Type, X-Agency-Id, X-Requested-With, Accept, Origin",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
