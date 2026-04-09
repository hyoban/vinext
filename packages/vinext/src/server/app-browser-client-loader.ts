import { createElement, forwardRef } from "react";
import { setRequireModule } from "@vitejs/plugin-rsc/core/browser";
import * as clientReferences from "virtual:vite-rsc/client-references";
import type { CachedRscResponse } from "../shims/navigation.js";

declare const __vite_rsc_raw_import__: (id: string) => Promise<unknown>;

type TrackedPromise<T> = Promise<T> & {
  reason?: unknown;
  status?: "fulfilled" | "pending" | "rejected";
  value?: T;
};

type MemoLikeValue = {
  $$typeof: symbol;
  displayName?: string;
  type?: unknown;
};

const CLIENT_REFERENCE_ROW_PATTERN = /(?:^|\n)[0-9a-fA-F]+:I\[("(?:\\.|[^"\\])*")/g;
const REACT_FORWARD_REF_TYPE = Symbol.for("react.forward_ref");
const REACT_MEMO_TYPE = Symbol.for("react.memo");
const textDecoder = new TextDecoder();
const clientModuleCache = new Map<string, TrackedPromise<unknown>>();
const stableMemoExportCache = new Map<string, unknown>();
const stableModuleExportCache = new Map<string, unknown>();
let installed = false;

function withTrailingSlash(path: string): string {
  return path[path.length - 1] === "/" ? path : `${path}/`;
}

function normalizeClientReferenceId(id: string): string {
  return id.split("$$cache=")[0];
}

function trackPromise<T>(promise: Promise<T>): TrackedPromise<T> {
  const tracked = promise as TrackedPromise<T>;
  if (tracked.status) {
    return tracked;
  }

  tracked.status = "pending";
  promise.then(
    (value) => {
      tracked.status = "fulfilled";
      tracked.value = value;
    },
    (reason) => {
      tracked.status = "rejected";
      tracked.reason = reason;
    },
  );
  return tracked;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function isForwardRefLikeValue(value: unknown): value is { $$typeof: symbol } {
  return isObjectRecord(value) && "$$typeof" in value && value.$$typeof === REACT_FORWARD_REF_TYPE;
}

function isMemoLikeValue(value: unknown): value is MemoLikeValue {
  return isObjectRecord(value) && "$$typeof" in value && value.$$typeof === REACT_MEMO_TYPE;
}

function createStableMemoProxy(
  normalizedId: string,
  exportName: string,
  value: MemoLikeValue,
): unknown {
  const cacheKey = `${normalizedId}#${exportName}`;
  const cached = stableMemoExportCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const target = value as unknown as Parameters<typeof createElement>[0];
  const supportsRef = isForwardRefLikeValue(value.type);

  const proxy = supportsRef
    ? forwardRef<unknown, Record<string, unknown>>(function VinextStableMemoProxy(props, ref) {
        return createElement(target, Object.assign({}, props, { ref }) as never);
      })
    : function VinextStableMemoProxy(props: Record<string, unknown>) {
        return createElement(target, props);
      };

  const namedProxy = proxy as { displayName?: string };
  namedProxy.displayName =
    value.displayName ??
    (typeof value.type === "function" && value.type.name ? value.type.name : exportName);

  stableMemoExportCache.set(cacheKey, namedProxy);
  return namedProxy;
}

function stabilizeClientModuleExports(normalizedId: string, moduleExports: unknown): unknown {
  const cached = stableModuleExportCache.get(normalizedId);
  if (cached) {
    return cached;
  }

  if (isMemoLikeValue(moduleExports)) {
    const stable = createStableMemoProxy(normalizedId, "default", moduleExports);
    stableModuleExportCache.set(normalizedId, stable);
    return stable;
  }

  if (
    !moduleExports ||
    (typeof moduleExports !== "object" && typeof moduleExports !== "function")
  ) {
    stableModuleExportCache.set(normalizedId, moduleExports);
    return moduleExports;
  }

  let changed = false;
  const next = Object.create(Object.getPrototypeOf(moduleExports));
  const descriptors = Object.getOwnPropertyDescriptors(moduleExports);

  for (const [exportName, descriptor] of Object.entries(descriptors)) {
    if ("value" in descriptor && isMemoLikeValue(descriptor.value)) {
      descriptor.value = createStableMemoProxy(normalizedId, exportName, descriptor.value);
      changed = true;
    }
    Object.defineProperty(next, exportName, descriptor);
  }

  const stableModuleExports = changed ? next : moduleExports;
  stableModuleExportCache.set(normalizedId, stableModuleExports);
  return stableModuleExports;
}

function loadClientReference(normalizedId: string): Promise<unknown> {
  if (!import.meta.env.__vite_rsc_build__) {
    return __vite_rsc_raw_import__(
      withTrailingSlash(import.meta.env.BASE_URL) + normalizedId.slice(1),
    ).then((moduleExports) => stabilizeClientModuleExports(normalizedId, moduleExports));
  }

  const importReference = clientReferences.default[normalizedId] as
    | (() => Promise<unknown>)
    | undefined;
  if (!importReference) {
    throw new Error(`client reference not found '${normalizedId}'`);
  }
  return importReference().then((moduleExports) =>
    stabilizeClientModuleExports(normalizedId, moduleExports),
  );
}

function getTrackedClientModule(id: string): TrackedPromise<unknown> {
  const normalizedId = normalizeClientReferenceId(id);
  const cached = clientModuleCache.get(normalizedId);
  if (cached) {
    return cached;
  }

  const tracked = trackPromise(Promise.resolve().then(() => loadClientReference(normalizedId)));
  clientModuleCache.set(normalizedId, tracked);
  return tracked;
}

export function installVinextBrowserClientLoader(): void {
  if (installed) {
    return;
  }

  installed = true;
  setRequireModule({
    load(id) {
      return getTrackedClientModule(id);
    },
  });
}

export async function prewarmClientReferencesFromSnapshot(
  snapshot: CachedRscResponse,
): Promise<void> {
  const payload = textDecoder.decode(snapshot.buffer);
  const pending: Promise<unknown>[] = [];

  CLIENT_REFERENCE_ROW_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CLIENT_REFERENCE_ROW_PATTERN.exec(payload))) {
    try {
      const id = JSON.parse(match[1]) as string;
      pending.push(getTrackedClientModule(id));
    } catch {
      // Ignore malformed rows and let the regular RSC decoder surface errors.
    }
  }

  if (pending.length === 0) {
    return;
  }

  await Promise.allSettled(pending);
}
