import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pkg = require("./package.json");

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    proxyClientMaxBodySize: "10gb",
    serverActions: {
      bodySizeLimit: "10gb",
    },
    // Next 16.3 made the tsc CLI the default, which type-checks test files
    // too. Keep checking only the app, as 16.2 did.
    useTypeScriptCli: false,
  },
  // "standalone" is set via NEXT_OUTPUT env var during Docker builds only
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" } : {}),
  images: {
    unoptimized: true,
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
  async headers() {
    return [
      {
        // Wallpapers ship with the release and never change under a given
        // name, but public/ is served with max-age=0, so every switch
        // re-downloaded ~365 KB — twice, since the accent-colour sampler
        // fetches the image again. Over a tunnel that is seconds of a click
        // doing nothing.
        source: "/images/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
