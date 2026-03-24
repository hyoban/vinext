export type RouterTransitionType = "push" | "replace" | "traverse";

export interface ClientInstrumentationHooks {
  onRouterTransitionStart?: (url: string, navigationType: RouterTransitionType) => void;
}

let instrumentationHooks: ClientInstrumentationHooks | null = null;

function extractHooks(mod: unknown): ClientInstrumentationHooks {
  if (!mod || typeof mod !== "object") {
    return {};
  }

  const maybeHooks = mod as ClientInstrumentationHooks & {
    default?: ClientInstrumentationHooks;
  };
  if (typeof maybeHooks.onRouterTransitionStart === "function") {
    return { onRouterTransitionStart: maybeHooks.onRouterTransitionStart };
  }

  if (maybeHooks.default && typeof maybeHooks.default.onRouterTransitionStart === "function") {
    return { onRouterTransitionStart: maybeHooks.default.onRouterTransitionStart };
  }

  return {};
}

export function setClientInstrumentationHooks(mod?: unknown): ClientInstrumentationHooks | null {
  instrumentationHooks = mod ? extractHooks(mod) : null;
  return instrumentationHooks;
}

export function getClientInstrumentationHooks(): ClientInstrumentationHooks | null {
  return instrumentationHooks;
}

export function notifyRouterTransitionStart(
  url: string,
  navigationType: RouterTransitionType,
): void {
  // Next.js only wires this hook through the App Router action queue.
  // Guarding on the app-router navigate handle keeps Pages Router behavior
  // aligned even if a shared shim calls into this helper.
  if (typeof window !== "undefined" && window.__VINEXT_ROOT__) {
    return;
  }
  instrumentationHooks?.onRouterTransitionStart?.(url, navigationType);
}
