import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { APP_FIXTURE_DIR, startFixtureServer, type TestServerResult } from "./helpers.js";

describe("instrumentation-client HMR", () => {
  let tmpDir: string;
  let testServer: TestServerResult;
  let browser: Browser;
  let page: Page;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vinext-inst-hmr-"));
    await fs.cp(APP_FIXTURE_DIR, tmpDir, {
      recursive: true,
      filter: (source) =>
        path.basename(source) !== "node_modules" &&
        !source.includes(`${path.sep}node_modules${path.sep}`),
    });
    await fs.symlink(path.join(APP_FIXTURE_DIR, "node_modules"), path.join(tmpDir, "node_modules"));

    testServer = await startFixtureServer(tmpDir);
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();

    await page.goto(`${testServer.baseUrl}/instrumentation-client-test`);
    await page.waitForFunction(() => Boolean((window as any).__VINEXT_RSC_ROOT__));
  });

  afterEach(async () => {
    await page?.close();
    await browser?.close();
    await testServer?.server.close();
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("reloads instrumentation-client when modified in dev", async () => {
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
