import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Processed LOLA assets are immutable outputs of scripts/process_lunar_data.py.
  async headers() {
    return [
      {
        source: "/data/lunar/:file*",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400" }],
      },
    ];
  },
};

export default nextConfig;
