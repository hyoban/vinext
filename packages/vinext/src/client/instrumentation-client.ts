export type RouterTransitionType = "push" | "replace" | "traverse";

export interface ClientInstrumentationHooks {
  onRouterTransitionStart?: (url: string, navigationType: RouterTransitionType) => void;
}

export type ClientInstrumentationLoader = () => Promise<unknown>;

let instrumentationHooks: ClientInstrumentationHooks | null = null;
let instrumentationPromise: Promise<ClientInstrumentationHooks | null> | null = null;

function getNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function logSlowClientInstrumentation(duration: number): void {
  console.log(
    `[Client Instrumentation Hook] Slow execution detected: ${duration.toFixed(0)}ms ` +
      "(Note: Code download overhead is not included in this measurement)",
  );
}

function extractHooks(mod: unknown): ClientInstrumentationHooks {
  if (!mod || typeof mod !== "object") {
    return {};
  }

  const maybeHooks = mod as ClientInstrumentationHooks;
  if (typeof maybeHooks.onRouterTransitionStart === "function") {
    return { onRouterTransitionStart: maybeHooks.onRouterTransitionStart };
  }

  return {};
}

async function loadInstrumentationModule(
  loader: ClientInstrumentationLoader,
): Promise<ClientInstrumentationHooks> {
  if (process.env.NODE_ENV === "development") {
    const startTime = getNow();
    const mod = await loader();
    const duration = getNow() - startTime;
    if (duration > 16) {
      logSlowClientInstrumentation(duration);
    }
    return extractHooks(mod);
  }

  return extractHooks(await loader());
}

export async function ensureClientInstrumentation(
  loader?: ClientInstrumentationLoader,
): Promise<ClientInstrumentationHooks | null> {
  if (instrumentationHooks) return instrumentationHooks;
  if (!loader) return null;
  if (instrumentationPromise) return instrumentationPromise;

  instrumentationPromise = loadInstrumentationModule(loader)
    .then((hooks) => {
      instrumentationHooks = hooks;
      return hooks;
    })
    .catch((error) => {
      instrumentationPromise = null;
      throw error;
    });

  return instrumentationPromise;
}

export function getClientInstrumentationHooks(): ClientInstrumentationHooks | null {
  return instrumentationHooks;
}

export function notifyRouterTransitionStart(
  url: string,
  navigationType: RouterTransitionType,
): void {
  instrumentationHooks?.onRouterTransitionStart?.(url, navigationType);
}
