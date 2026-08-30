import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root to this project. Without this, a stray
  // package-lock.json in the home directory makes Next infer the wrong root.
  turbopack: {
    root: __dirname,
  },
  experimental: {
    // Enables forbidden() / unauthorized() and the app/forbidden.tsx file
    // convention, which is how wrong-role requests return a real HTTP 403
    // instead of being silently redirected. See lib/auth/index.ts.
    authInterrupts: true,

    // In this Next version serverActions config lives under `experimental`
    // (verified against node_modules/next/dist/server/config-shared.d.ts).
    serverActions: {
      // CSRF / CORS POSTURE — SAME ORIGIN ONLY.
      //
      // Next compares the Origin header to Host on every Server Action and
      // aborts on a mismatch. `allowedOrigins` widens that allow-list; leaving
      // it EMPTY means only this app's own origin can invoke an action. There
      // is deliberately no wildcard here, and there must never be one: every
      // action in this app is authenticated and state-changing.
      allowedOrigins: [],

      // The student import uploads a file through a Server Action, and the
      // default body limit is 1 MB — below the 5 MB file ceiling enforced in
      // lib/import/parse.ts. This raises the transport limit just enough to let
      // a legitimate 5 MB upload reach the parser, which then applies the real
      // limit. Kept deliberately close to it: this is the outermost bound on
      // how much an authenticated caller can make the server buffer.
      bodySizeLimit: "6mb",
    },
  },

  // Security headers that are the SAME on every request live here. The
  // Content-Security-Policy is NOT here — it carries a per-request nonce, so it
  // is built in proxy.ts where the request is visible.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // No CORS allow-origin header is emitted ANYWHERE in this app, so
          // browsers apply the same-origin policy by default and no
          // cross-origin site can read a response. These add the explicit
          // isolation headers on top.
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },

          // Stop the browser guessing a response's type — the defence against
          // a stored file being sniffed into executable script.
          { key: "X-Content-Type-Options", value: "nosniff" },

          // Clickjacking. X-Frame-Options is the legacy header; the modern
          // equivalent (frame-ancestors 'none') is in the CSP in proxy.ts.
          // Both are sent because older browsers honour only the former.
          { key: "X-Frame-Options", value: "DENY" },

          // Send the full URL only to ourselves; cross-origin requests leak the
          // origin alone, so a student ID never rides along in a Referer.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },

          // HSTS: 2 years, subdomains included, preload-eligible.
          //
          // Browsers IGNORE this header over plain HTTP, so shipping it in dev
          // is harmless; it takes effect only once the response arrives over
          // HTTPS. Vercel terminates TLS and redirects HTTP->HTTPS already, so
          // this is what pins that redirect into the browser itself and closes
          // the first-visit downgrade window.
          //
          // NOTE ON `preload`: submitting the domain to hstspreload.org is
          // effectively PERMANENT and applies to every subdomain. The directive
          // is present so the header qualifies, but nothing is preloaded until
          // you submit the domain yourself — see the manual checklist.
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },

          // Turn off browser features this portal never uses, so a future
          // injected script cannot reach for them either.
          {
            key: "Permissions-Policy",
            value: [
              "accelerometer=()",
              "autoplay=()",
              "camera=()",
              "display-capture=()",
              "encrypted-media=()",
              "fullscreen=(self)",
              "geolocation=()",
              "gyroscope=()",
              "magnetometer=()",
              "microphone=()",
              "midi=()",
              "payment=()",
              "picture-in-picture=()",
              "publickey-credentials-get=()",
              "screen-wake-lock=()",
              "usb=()",
              "xr-spatial-tracking=()",
            ].join(", "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
