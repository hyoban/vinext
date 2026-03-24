/**
 * E2E test for instrumentation-client.ts HMR support.
 *
 * This runs under the Playwright app-router project so Chromium is available.
 * It uses an isolated temporary fixture and its own Vite dev server to avoid
 * mutating the shared app-basic fixture used by other app-router specs.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test, expect } from "@playwright/test";
import type { ViteDevServer } from "vite";

const APP_FIXTURE_DIR = path.resolve(__dirname, "../../fixtures/app-basic");

interface TestServerResult {
  server: ViteDevServer;
  baseUrl: string;
}

async function startFixtureServer(fixtureDir: string): Promise<TestServerResult> {
  const { createServer } = await import("vite");
  const vinext = (await import("../../../packages/vinext/src/index.js")).default;

  const server = await createServer({
    root: fixtureDir,
    configFile: false,
    plugins: [vinext({ appDir: fixtureDir })],
    optimizeDeps: {
      holdUntilCrawlEnd: true,
    },
    server: {
      port: 0,
      cors: false,
    },
    logLevel: "silent",
  });

  await server.listen();
  const addr = server.httpServer?.address();
  if (!addr || typeof addr !== "object") {
    throw new Error("Failed to determine fixture server address");
  }

  return {
    server,
    baseUrl: `http://localhost:${addr.port}`,
  };
}

test.describe("instrumentation-client.ts HMR", () => {
  let tmpDir: string;
  let testServer: TestServerResult;

  test.beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vinext-inst-hmr-"));
    await fs.cp(APP_FIXTURE_DIR, tmpDir, {
      recursive: true,
      filter: (source) =>
        path.basename(source) !== "node_modules" &&
        !source.includes(`${path.sep}node_modules${path.sep}`),
    });
    await fs.symlink(path.join(APP_FIXTURE_DIR, "node_modules"), path.join(tmpDir, "node_modules"));

    testServer = await startFixtureServer(tmpDir);
  });

  test.afterEach(async () => {
    await testServer?.server.close();
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("reloads instrumentation-client when modified in dev", async ({ page }) => {
    await page.goto(`${testServer.baseUrl}/instrumentation-client-test`);
    await page.waitForFunction(() => Boolean((window as any).__VINEXT_RSC_ROOT__));

    const instrumentationPath = path.join(tmpDir, "src", "instrumentation-client.ts");
    const original = await fs.readFile(instrumentationPath, "utf8");
    const initialTime = await page.evaluate(
      () => (window as any).__VINEXT_INSTRUMENTATION_CLIENT_EXECUTED_AT,
    );

    await fs.writeFile(
      instrumentationPath,
      `
;(window as any).__VINEXT_INSTRUMENTATION_CLIENT_EXECUTED_AT = performance.now();
;(window as any).__VINEXT_INSTRUMENTATION_CLIENT_UPDATED = true;
;(window as any).__VINEXT_APP_INSTRUMENTATION_NAVS__ =
  (window as any).__VINEXT_APP_INSTRUMENTATION_NAVS__ ?? [];

export function onRouterTransitionStart(href: string, navigationType: string) {
  (window as any).__VINEXT_APP_INSTRUMENTATION_NAVS__.push({
    href,
    navigationType,
    pathname: new URL(href, window.location.href).pathname,
  });
}
`,
      "utf8",
    );

    try {
      await page.waitForFunction(() =>
        Boolean((window as any).__VINEXT_INSTRUMENTATION_CLIENT_UPDATED),
      );

      const updatedTime = await page.evaluate(
        () => (window as any).__VINEXT_INSTRUMENTATION_CLIENT_EXECUTED_AT,
      );

      expect(updatedTime).not.toBe(initialTime);
    } finally {
      await fs.writeFile(instrumentationPath, original, "utf8");
    }
  });
});
