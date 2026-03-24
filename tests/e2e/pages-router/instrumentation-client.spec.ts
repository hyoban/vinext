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

  test("logs the dev slow-hook warning when instrumentation-client is slow", async ({ page }) => {
    const logs: string[] = [];
    page.on("console", (message) => {
      logs.push(message.text());
    });

    await page.goto("/");
    await page.waitForFunction(() => Boolean((window as any).__VINEXT_ROOT__));

    expect(
      logs.some((message) =>
        message.startsWith("[Client Instrumentation Hook] Slow execution detected:"),
      ),
    ).toBe(true);
  });

  test("ignores exported onRouterTransitionStart for router.push and Link navigations", async ({
    page,
  }) => {
    await page.goto("/router-events-test");
    await page.waitForFunction(() => Boolean((window as any).__VINEXT_ROOT__));

    await page.evaluate(() => {
      (window as any).__VINEXT_PAGES_INSTRUMENTATION_NAVS__ = [];
    });

    await page.click('[data-testid="push-about"]');
    await expect(page.locator("h1")).toHaveText("About");

    const navs = await page.evaluate(() => (window as any).__VINEXT_PAGES_INSTRUMENTATION_NAVS__);
    expect(navs).toEqual([]);

    await page.goBack();
    await expect(page.locator("h1")).toHaveText("Router Events Test");

    await page.click('[data-testid="link-about"]');
    await expect(page.locator("h1")).toHaveText("About");

    const navsAfterLink = await page.evaluate(
      () => (window as any).__VINEXT_PAGES_INSTRUMENTATION_NAVS__,
    );
    expect(navsAfterLink).toEqual([]);
  });
});
