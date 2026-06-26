import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root to this project. Without this, a stray
  // package-lock.json in the home directory makes Next infer the wrong root.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
