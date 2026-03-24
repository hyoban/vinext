(window as any).__VINEXT_INSTRUMENTATION_CLIENT_EXECUTED_AT = performance.now();
(window as any).__VINEXT_APP_INSTRUMENTATION_NAVS__ =
  (window as any).__VINEXT_APP_INSTRUMENTATION_NAVS__ ?? [];

const start = performance.now();
while (performance.now() - start < 20) {
  // Intentionally block for >16ms to exercise the dev slow-hook warning.
}

export function onRouterTransitionStart(href: string, navigationType: string) {
  (window as any).__VINEXT_APP_INSTRUMENTATION_NAVS__.push({
    href,
    navigationType,
    pathname: new URL(href, window.location.href).pathname,
  });
}
