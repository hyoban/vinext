import { defineConfig } from "vite-plus";
import vinext from "vinext";
import tailwindcss from "@tailwindcss/vite";
import fumadocsMdx from "fumadocs-mdx/vite";
import * as sourceConfig from "./source.config";

export default defineConfig(async () => ({
  plugins: [
    tailwindcss(),
    await fumadocsMdx(sourceConfig),
    vinext(),
  ],
}));
