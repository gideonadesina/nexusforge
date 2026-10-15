import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The falkordb client is a server-only dependency. Keep it out of any
  // client bundle so credentials and socket code never ship to the browser.
  serverExternalPackages: ["falkordb"],
};

export default nextConfig;
