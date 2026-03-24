/**
 * E2E tests for instrumentation-client.ts support in Pages Router.
 *
 * Ported from Next.js:
 * test/e2e/instrumentation-client-hook/instrumentation-client-hook.test.ts
 * https://github.com/vercel/next.js/blob/canary/test/e2e/instrumentation-client-hook/instrumentation-client-hook.test.ts
 */

import { test, expect } from "@playwright/test";

test.describe("instrumentation-client.ts (Pages Router)", () => {
  test("executes root instrumentation-client before hydration", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(
      () =>
        typeof (window as any).__VINEXT_INSTRUMENTATION_CLIENT_EXECUTED_AT === "number" &&
        typeof (window as any).__VINEXT_HYDRATED_AT__ === "number" &&
        Boolean((window as any).__VINEXT_ROOT__),
    );

    const timings = await page.evaluate(() => ({
      instrumentation: (window as any).__VINEXT_INSTRUMENTATION_CLIENT_EXECUTED_AT,
      hydration: (window as any).__VINEXT_HYDRATED_AT__,
    }));

    expect(timings.instrumentation).toBeLessThan(timings.hydration);
  });

  test("ignores exported onRouterTransitionStart for parity with Next.js", async ({ page }) => {
    await page.goto("/router-events-test");
    await page.waitForFunction(() => Boolean((window as any).__VINEXT_ROOT__));

    await page.evaluate(() => {
      (window as any).__VINEXT_PAGES_INSTRUMENTATION_NAVS__ = [];
    });

    await page.click('[data-testid="push-about"]');
    await expect(page.locator("h1")).toHaveText("About");

    const navs = await page.evaluate(() => (window as any).__VINEXT_PAGES_INSTRUMENTATION_NAVS__);
    expect(navs).toEqual([]);
  });
});
