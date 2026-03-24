/**
 * E2E tests for instrumentation-client.ts support.
 *
 * Ported from Next.js:
 * test/e2e/instrumentation-client-hook/instrumentation-client-hook.test.ts
 * https://github.com/vercel/next.js/blob/canary/test/e2e/instrumentation-client-hook/instrumentation-client-hook.test.ts
 */

import { test, expect } from "@playwright/test";

async function waitForHydration(page: import("@playwright/test").Page) {
  await page.waitForFunction(
    () =>
      typeof (window as any).__VINEXT_INSTRUMENTATION_CLIENT_EXECUTED_AT === "number" &&
      typeof (window as any).__VINEXT_RSC_HYDRATED_AT__ === "number" &&
      Boolean((window as any).__VINEXT_RSC_ROOT__),
  );
}

test.describe("instrumentation-client.ts (App Router)", () => {
  test("executes src/instrumentation-client before hydration", async ({ page }) => {
    await page.goto("/instrumentation-client-test");
    await waitForHydration(page);

    const timings = await page.evaluate(() => ({
      instrumentation: (window as any).__VINEXT_INSTRUMENTATION_CLIENT_EXECUTED_AT,
      hydration: (window as any).__VINEXT_RSC_HYDRATED_AT__,
    }));

    expect(timings.instrumentation).toBeLessThan(timings.hydration);
  });

  test("logs the dev slow-hook warning when instrumentation-client is slow", async ({ page }) => {
    const logs: string[] = [];
    page.on("console", (message) => {
      logs.push(message.text());
    });

    await page.goto("/instrumentation-client-test");
    await waitForHydration(page);

    expect(
      logs.some((message) =>
        message.startsWith("[Client Instrumentation Hook] Slow execution detected:"),
      ),
    ).toBe(true);
  });

  test("onRouterTransitionStart fires for push and traverse", async ({ page }) => {
    await page.goto("/instrumentation-client-test");
    await waitForHydration(page);

    await page.evaluate(() => {
      (window as any).__VINEXT_APP_INSTRUMENTATION_NAVS__ = [];
    });

    await page.click("#push-about");
    await expect(page.locator("h1")).toHaveText("About");

    await page.goBack();
    await expect(page.locator("#instrumentation-client-test")).toHaveText(
      "Instrumentation Client Test",
    );

    await page.goForward();
    await expect(page.locator("h1")).toHaveText("About");

    const navs = await page.evaluate(() => (window as any).__VINEXT_APP_INSTRUMENTATION_NAVS__);
    expect(
      navs.map(
        (entry: { navigationType: string; pathname: string }) =>
          `${entry.navigationType}:${entry.pathname}`,
      ),
    ).toEqual(["push:/about", "traverse:/instrumentation-client-test", "traverse:/about"]);
  });

  test("onRouterTransitionStart fires for replace", async ({ page }) => {
    await page.goto("/instrumentation-client-test");
    await waitForHydration(page);

    await page.evaluate(() => {
      (window as any).__VINEXT_APP_INSTRUMENTATION_NAVS__ = [];
    });

    await page.click("#replace-dashboard");
    await expect(page.locator("h1")).toHaveText("Dashboard");

    const navs = await page.evaluate(() => (window as any).__VINEXT_APP_INSTRUMENTATION_NAVS__);
    expect(
      navs.map(
        (entry: { navigationType: string; pathname: string }) =>
          `${entry.navigationType}:${entry.pathname}`,
      ),
    ).toEqual(["replace:/dashboard"]);
  });
});
