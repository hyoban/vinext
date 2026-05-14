/**
 * Next.js Compat E2E: app-prefetch (browser tests)
 *
 * Ported from: https://github.com/vercel/next.js/blob/canary/test/e2e/app-dir/app-prefetch/prefetching.test.ts
 *
 * Tests Link prefetching and navigation behavior.
 */

import { test, expect } from "@playwright/test";
import { waitForAppRouterHydration } from "../../helpers";

const BASE = "http://localhost:4174";

type PrefetchTestState = {
  fetchUrls: string[];
  requestIdleCallbackCalls: number;
};

type PrefetchTestWindow = Window & Partial<Record<"__VINEXT_PREFETCH_TEST__", PrefetchTestState>>;

test.describe("Next.js compat: prefetch (browser)", () => {
  // Next.js: 'should navigate when prefetch is false'
  test("should navigate when prefetch is false", async ({ page }) => {
    await page.goto(`${BASE}/nextjs-compat/prefetch-test`);
    await waitForAppRouterHydration(page);

    // Click the no-prefetch link
    await page.click("#no-prefetch-link");
    await expect(page.locator("#no-prefetch-target")).toHaveText("No Prefetch Target Page", {
      timeout: 10_000,
    });
  });

  // Test that prefetched link navigates correctly
  test("should navigate via prefetched link", async ({ page }) => {
    await page.goto(`${BASE}/nextjs-compat/prefetch-test`);
    await waitForAppRouterHydration(page);

    // Click the prefetch link
    await page.click("#prefetch-link");
    await expect(page.locator("#prefetch-target")).toHaveText("Prefetch Target Page", {
      timeout: 10_000,
    });
  });

  // Test that prefetched navigation preserves client state (no full reload)
  test("prefetched navigation does not cause full page reload", async ({ page }) => {
    await page.goto(`${BASE}/nextjs-compat/prefetch-test`);
    await waitForAppRouterHydration(page);

    // Set marker to detect full reload
    await page.evaluate(() => {
      (window as any).__PREFETCH_MARKER__ = true;
    });

    // Navigate via prefetched link
    await page.click("#prefetch-link");
    await expect(page.locator("#prefetch-target")).toHaveText("Prefetch Target Page", {
      timeout: 10_000,
    });

    // Marker should survive (no full reload)
    const marker = await page.evaluate(() => (window as any).__PREFETCH_MARKER__);
    expect(marker).toBe(true);
  });

  test("Link with prefetch={false} does not prefetch RSC payload in dev", async ({ page }) => {
    await page.addInitScript(() => {
      const testWindow: PrefetchTestWindow = window;
      const originalFetch = window.fetch.bind(window);
      const originalRequestIdleCallback = window.requestIdleCallback?.bind(window);
      const state: PrefetchTestState = {
        fetchUrls: [],
        requestIdleCallbackCalls: 0,
      };
      testWindow.__VINEXT_PREFETCH_TEST__ = state;
      window.fetch = (input, init) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes(".rsc")) {
          state.fetchUrls.push(url);
        }
        return originalFetch(input, init);
      };
      window.requestIdleCallback = (callback, options) => {
        state.requestIdleCallbackCalls += 1;
        if (originalRequestIdleCallback) {
          return originalRequestIdleCallback(callback, options);
        }
        return window.setTimeout(() => {
          callback({
            didTimeout: false,
            timeRemaining: () => 50,
          });
        }, 1);
      };
    });

    await page.goto(`${BASE}/nextjs-compat/prefetch-test`);
    await waitForAppRouterHydration(page);

    // Verify the fetch instrumentation sees .rsc URLs before relying on it
    // to assert that Link prefetch does not issue a no-prefetch request.
    await page.evaluate(async () => {
      await window.fetch("/nextjs-compat/prefetch-test/target.rsc");
    });
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const testWindow: PrefetchTestWindow = window;
          const state = testWindow.__VINEXT_PREFETCH_TEST__;
          if (state === undefined) throw new Error("Missing prefetch test instrumentation");
          return state.fetchUrls.some((url) => url.includes("target.rsc"));
        }),
      )
      .toBe(true);

    await page.evaluate(() => {
      const testWindow: PrefetchTestWindow = window;
      const state = testWindow.__VINEXT_PREFETCH_TEST__;
      if (state === undefined) throw new Error("Missing prefetch test instrumentation");
      state.fetchUrls = [];
      state.requestIdleCallbackCalls = 0;
    });

    await page.hover("#no-prefetch-link");
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );

    const diagnostics = await page.evaluate(() => {
      const testWindow: PrefetchTestWindow = window;
      const state = testWindow.__VINEXT_PREFETCH_TEST__;
      if (state === undefined) throw new Error("Missing prefetch test instrumentation");
      return {
        fetchUrls: state.fetchUrls,
        requestIdleCallbackCalls: state.requestIdleCallbackCalls,
      };
    });
    expect(diagnostics.fetchUrls.some((url) => url.includes("no-prefetch.rsc"))).toBe(false);
    expect(diagnostics.requestIdleCallbackCalls).toBe(0);
  });
});
