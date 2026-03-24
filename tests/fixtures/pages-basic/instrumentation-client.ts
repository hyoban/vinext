(window as any).__VINEXT_INSTRUMENTATION_CLIENT_EXECUTED_AT = performance.now();
(window as any).__VINEXT_PAGES_INSTRUMENTATION_NAVS__ =
  (window as any).__VINEXT_PAGES_INSTRUMENTATION_NAVS__ ?? [];

export function onRouterTransitionStart(href: string, navigationType: string) {
  (window as any).__VINEXT_PAGES_INSTRUMENTATION_NAVS__.push({
    href,
    navigationType,
    pathname: new URL(href, window.location.href).pathname,
  });
}
