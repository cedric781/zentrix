import path from "path";
import { fileURLToPath } from "url";
import type { NextConfig } from "next";

// Content-Security-Policy
// - script-src: 'unsafe-inline' for Next.js hydration, 'unsafe-eval' required by Privy SDK
// - connect-src: Privy auth + Solana RPC + external APIs
// - frame-src: Privy auth iframe
const CSP = [
  // Fallback for any directive not explicitly listed below.
  "default-src 'self'",

  // Scripts: unsafe-inline for Next.js hydration, unsafe-eval for Privy SDK
  // runtime code-gen, wasm-unsafe-eval to compile WASM inside the blob worker.
  // blob: required for iOS WebKit which needs explicit blob script permission.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:",

  // Styles: inline styles for component libraries + Google Fonts stylesheet.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",

  // Images: data URIs for inline SVGs/QR codes, blob for QR generation, HTTPS for remote.
  "img-src 'self' data: blob: https:",

  // Fonts: Google Fonts static files.
  "font-src 'self' https://fonts.gstatic.com",

  // Network: every origin the app legitimately fetches from at runtime.
  [
    "connect-src 'self'",
    // Privy — HTTPS auth + CDN (serves WASM binary) + WSS real-time channel
    "https://auth.privy.io",
    "https://*.privy.io",
    "wss://*.privy.io",
    // Privy vendor dependency: walletconnect (cannot disable)
    "https://explorer-api.walletconnect.com",
    "https://*.walletconnect.com",
    "wss://relay.walletconnect.com",
    "wss://*.walletconnect.com",
    // Solana RPC (Helius for Zentrix)
    "https://api.mainnet-beta.solana.com",
    "https://*.helius-rpc.com",
    "https://*.quiknode.pro",
    // External data APIs (P30 auto-resolve)
    "https://site.api.espn.com",
    "https://www.thesportsdb.com",
  ].join(" "),

  // Iframes: Privy auth modal + WalletConnect verify (Privy SDK vendor dep).
  [
    "frame-src 'self'",
    "https://auth.privy.io",
    "https://*.privy.io",
    "https://verify.walletconnect.com",
  ].join(" "),

  // Workers: Privy SDK spawns a Web Worker from a blob: URL for embedded
  // wallet key derivation (ed25519/Solana). Without blob: the worker is
  // silently killed and login hangs after OTP verification.
  "worker-src 'self' blob:",

  // Child contexts (iframes + workers via window.open / new Worker).
  "child-src 'self' blob:",

  // Block <object>/<embed>/<applet>.
  "object-src 'none'",

  // Restrict <base href> hijacking.
  "base-uri 'self'",

  // Restrict form submissions to same-origin.
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const emptyStub = path.resolve(__dirname, "src/lib/stubs/empty.js");

const nextConfig: NextConfig = {
  // Disable source maps in production — prevents exposing original source code.
  productionBrowserSourceMaps: false,

  // Block @metamask/sdk — Wagmi connector dependency, not needed for Privy+Solana.
  turbopack: {
    root: __dirname,
    resolveAlias: {
      "@metamask/sdk": emptyStub,
      "@metamask/sdk-install-modal-web": emptyStub,
    },
  },
  webpack: (config) => {
    config.resolve.alias["@metamask/sdk"] = false;
    config.resolve.alias["@metamask/sdk-install-modal-web"] = false;
    // Prevent Node.js polyfills from reintroducing eval.
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
    };
    return config;
  },

  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 3600,
  },

  compress: true,
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
      {
        source: "/api/(.*)",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
    ];
  },
};

export default nextConfig;
