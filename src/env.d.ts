/// <reference types="astro/client" />

interface Env {
  /** Zamp API key — set as a SECRET env var in Webflow Cloud; .dev.vars locally. */
  ZAMP_API_KEY: string;
  /** Optional Webflow Cloud Key Value Store binding for durable rate caching. */
  RATES?: any;
}

type Runtime = import('@astrojs/cloudflare').Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {}
}
