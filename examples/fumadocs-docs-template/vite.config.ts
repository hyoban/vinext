import { defineConfig } from "vite-plus";
import vinext from "vinext";
import tailwindcss from "@tailwindcss/vite";
import fumadocsMdx from "fumadocs-mdx/vite";
import * as sourceConfig from "./source.config";

export default defineConfig(async () => ({
  // we do this to avoid Vite from bundling React contexts and cause duplicated contexts conflicts.
  optimizeDeps: {
    exclude: [
      'fumadocs-ui',
      'fumadocs-core',
      '@unpic/react',
      '@unpic/core',
      'unpic'
    ],
    include: [
      'fumadocs-ui > debug',
      'fumadocs-core > extend',
      '@mdx-js/rollup > extend',
      'fumadocs-mdx > extend',
      'fumadocs-core > style-to-js',
      '@mdx-js/rollup > style-to-js',
      'fumadocs-mdx > style-to-js',
    ],
  },
  ssr: {
    external: ['@takumi-rs/image-response'],
  },
  plugins: [
    tailwindcss(),
    await fumadocsMdx(sourceConfig),
    vinext(),
  ],
}));
