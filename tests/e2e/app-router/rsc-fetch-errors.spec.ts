/**
 * RSC fetch error handling tests.
 *
 * Verifies that when an RSC navigation fetch returns a non-ok response (404,
 * 500), the client performs a clean hard navigation to the destination URL
 * rather than trying to parse the HTML error body as an RSC stream.
 *
 * Without the fix:
 *   - fetch(url.rsc) returns 404 HTML
 *   - createFromFetch throws a cryptic stream-parse error
 *   - The catch block logs "[vinext] RSC navigation error: ..." and hard-navs
 *     to the same URL again, which can loop
 *
 * With the fix:
 *   - !response.ok is detected immediately after fetch
 *   - Client hard-navigates directly to the destination URL (no .rsc suffix)
 *   - No stream-parse error is logged
 *
 * Ported behavior from Next.js fetch-server-response.ts:211:
 *   if (!isFlightResponse || !res.ok || !res.body) {
 *     return doMpaNavigation(responseUrl.toString())
 *   }
 */
import { test, expect } from "@playwright/test";
import { waitForAppRouterHydration } from "../helpers";

const BASE = "http://localhost:4174";

// Stream-parse errors thrown by createFromFetch / createFromReadableStream
// when handed a non-RSC payload (HTML error body, wrong content-type, empty
// stream). The pre-fix failure path produces one of these diagnostics; the
// filter here stays narrow on purpose so unrelated console errors (hydration
// timing, third-party scripts, JSON.parse in fixture code) never
// false-positive. Generic strings ("Connection closed", "Unexpected token")
// are gated on an RSC-context co-marker so a benign third-party JSON.parse
// diagnostic cannot satisfy them.
function isRscStreamParseError(msg: string): boolean {
  const hasRscContext = msg.includes("RSC") || msg.includes("vinext");
  return (
    msg.includes("createFromFetch") ||
    msg.includes("createFromReadableStream") ||
    msg.includes("Failed to parse RSC") ||
    (hasRscContext && msg.includes("Connection closed")) ||
    (hasRscContext && msg.includes("Unexpected token"))
  );
}

test.describe("RSC fetch non-ok response handling", () => {
  test("client navigation to a non-existent route hard-navs to the non-.rsc URL", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto(`${BASE}/about`);
    await waitForAppRouterHydration(page);

    // Trigger RSC navigation to a route that does not exist (returns 404 HTML).
    // We need to wait for the hard navigation, so we listen for the URL to change.
    const navigationPromise = page.waitForURL(`${BASE}/this-route-does-not-exist`, {
      timeout: 10_000,
    });
    await page.evaluate(() => {
      void (window as any).__VINEXT_RSC_NAVIGATE__("/this-route-does-not-exist");
    });
    await navigationPromise;

    // The browser must land on the non-.rsc URL — never on the .rsc variant.
    expect(page.url()).toBe(`${BASE}/this-route-does-not-exist`);

    // The bug this PR fixes surfaces as one of a small set of RSC-stream
    // parse errors when createFromFetch is handed an HTML body. Match only
    // those diagnostics so an unrelated console error (e.g. a hydration-
    // timing race that pre-existed this PR) does not false-positive here.
    const rscParseError = consoleErrors.find((msg) => isRscStreamParseError(msg));
    expect(rscParseError).toBeUndefined();
  });

  test("client navigation to a 500-route hard-navs to the destination URL without looping", async ({
    page,
  }) => {
    // Intercept the .rsc request for /about and return a 500 error. This
    // intercept persists across navigations and reloads on this page, so if
    // the fix is incomplete and a reload loop develops, the intercept hit
    // count will grow without bound.
    let aboutRscHits = 0;
    await page.route(/\/about\.rsc(\?|$)/, (route) => {
      aboutRscHits += 1;
      return route.fulfill({
        status: 500,
        // status 500 + text/html exercises both the !ok guard and the
        // content-type guard at the nav site; editing either value in
        // isolation drops the combined-guard coverage this test targets.
        contentType: "text/html",
        body: "<html><body><h1>Internal Server Error</h1></body></html>",
      });
    });

    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto(`${BASE}/`);
    await waitForAppRouterHydration(page);

    const navigationPromise = page.waitForURL(`${BASE}/about`, { timeout: 10_000 });
    await page.evaluate(() => {
      void (window as any).__VINEXT_RSC_NAVIGATE__("/about");
    });
    await navigationPromise;

    expect(page.url()).toBe(`${BASE}/about`);

    // Stability check: the hard-nav must settle. Without the
    // readInitialRscStream reload-loop guard, the initial RSC fetch on the
    // freshly-loaded /about page hits the intercepted 500 and reloads
    // indefinitely — networkidle would never fire and the default timeout
    // catches that. Tracking actual request activity avoids flaky wall-clock
    // waits in CI.
    const hitsBeforeNetworkIdle = aboutRscHits;
    await page.waitForLoadState("networkidle");
    expect(page.url()).toBe(`${BASE}/about`);
    // Pin the embedded-RSC assumption: after the hard-nav lands on /about,
    // hydration must come from the HTML-embedded RSC branch and issue no
    // further .rsc fetches. If a future change makes the embed path
    // conditional and falls back to a fetch, this count would grow and the
    // test would flag it rather than silently relying on networkidle timing.
    expect(aboutRscHits).toBe(hitsBeforeNetworkIdle);

    // Expected trajectory: up to two hits — one from the home-page Link
    // prefetch of /about.rsc (which the prefetch-cache discards because the
    // response is !ok), and one from the client RSC nav fetch that triggers
    // the hard-nav. Hydration timing can race the prefetch, in which case
    // the count is 1. After the hard navigation to /about, the embedded-RSC
    // branch in readInitialRscStream handles hydration without a fallback
    // .rsc fetch, so no post-reload hits occur. A runaway reload loop would
    // produce many more.
    // Lower bound: at minimum, the client nav fetch that triggers the
    // hard-nav must have fired. A value of 0 would mean the navigation
    // skipped the RSC fetch entirely and the test is no longer exercising
    // the !ok-guard path.
    expect(aboutRscHits).toBeGreaterThanOrEqual(1);
    expect(aboutRscHits).toBeLessThanOrEqual(2);

    const rscParseError = consoleErrors.find((msg) => isRscStreamParseError(msg));
    expect(rscParseError).toBeUndefined();
  });

  test("redirect chain to a non-ok endpoint hard-navs to the post-redirect URL", async ({
    page,
  }) => {
    // Chain: client nav to /redirect-test → fetch /redirect-test.rsc →
    // 307 Location /about.rsc → 500. The hard-nav target must be /about
    // (the post-redirect URL), not /redirect-test (the original request).
    // Without the navResponseUrl ?? navResponse.url branch in the nav-site
    // guard, the browser would bounce off /redirect-test and the server
    // would re-issue the 307, flashing the wrong URL in the address bar
    // and mis-keying analytics.
    let aboutRscHits = 0;
    await page.route(/\/about\.rsc(\?|$)/, (route) => {
      aboutRscHits += 1;
      return route.fulfill({
        status: 500,
        contentType: "text/html",
        body: "<html><body><h1>Internal Server Error</h1></body></html>",
      });
    });

    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    // Capture the document URL at every main-frame navigation so we can
    // assert the address bar never flashes /redirect-src en route to /about.
    // Without this, a regression that dropped `navResponseUrl ?? navResponse.url`
    // would still pass because the server's 307 converges to /about eventually.
    const frameUrls: string[] = [];
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) frameUrls.push(frame.url());
    });

    await page.goto(`${BASE}/`);
    await waitForAppRouterHydration(page);

    const navigationPromise = page.waitForURL(`${BASE}/about`, { timeout: 10_000 });
    await page.evaluate(() => {
      void (window as any).__VINEXT_RSC_NAVIGATE__("/redirect-test");
    });
    await navigationPromise;

    expect(page.url()).toBe(`${BASE}/about`);
    expect(frameUrls.some((url) => url.includes("/redirect-test"))).toBe(false);
    expect(aboutRscHits).toBeGreaterThanOrEqual(1);

    const rscParseError = consoleErrors.find((msg) => isRscStreamParseError(msg));
    expect(rscParseError).toBeUndefined();
  });
});
