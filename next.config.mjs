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
        // Homeio controls the whole machine (shutdown, disk format, app
        // install), so the dashboard must never be embedded in another site:
        // without this a hidden iframe could clickjack an admin into acting.
        // Set at the app so the tunnel, a bare nginx and the Docker image all
        // carry it. `frame-ancestors 'none'` is the only CSP directive here —
        // a full script/style policy would need per-response nonces and risks
        // breaking the app, while framing protection costs nothing.
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // The dashboard uses no camera, microphone or geolocation in the
          // browser; deny them so a future XSS cannot either.
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          // Honoured only over HTTPS (the Cloudflare tunnel), ignored on a
          // plain-HTTP LAN address, so it is safe to send everywhere.
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
        ],
      },
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
