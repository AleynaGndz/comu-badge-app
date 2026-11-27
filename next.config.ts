import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "sapphire-known-weasel-75.mypinata.cloud",
      },
    ],
  },
};

export default nextConfig;