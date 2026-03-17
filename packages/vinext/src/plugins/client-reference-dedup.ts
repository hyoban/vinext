import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { DevEnvironment, Environment, Plugin } from "vite";

/**
 * Extract the bare package name from an absolute file path containing node_modules.
 *
 * Handles scoped packages (`@org/name`) and nested node_modules.
 * Returns `null` if the path doesn't contain `/node_modules/`.
 */
export function extractPackageName(absolutePath: string): string | null {
  const marker = "/node_modules/";
  const lastIdx = absolutePath.lastIndexOf(marker);
  if (lastIdx === -1) return null;

  const rest = absolutePath.slice(lastIdx + marker.length);
  if (rest.startsWith("@")) {
    // Scoped package: @org/name
    const parts = rest.split("/");
    if (parts.length < 2) return null;
    return `${parts[0]}/${parts[1]}`;
  }
  // Regular package: name
  const slashIdx = rest.indexOf("/");
  return slashIdx === -1 ? rest : rest.slice(0, slashIdx);
}

/**
 * Extract the absolute package root directory from an absolute file path
 * containing node_modules.
 */
function extractPackageRoot(absolutePath: string): string | null {
  const marker = "/node_modules/";
  const lastIdx = absolutePath.lastIndexOf(marker);
  if (lastIdx === -1) return null;

  const rootPrefix = absolutePath.slice(0, lastIdx + marker.length);
  const rest = absolutePath.slice(lastIdx + marker.length);
  const parts = rest.split("/");
  if (parts.length === 0) return null;

  if (parts[0]?.startsWith("@")) {
    if (parts.length < 2) return null;
    return `${rootPrefix}${parts[0]}/${parts[1]}`;
  }

  return `${rootPrefix}${parts[0]}`;
}

function packageHasRootExport(packageRoot: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(`${packageRoot}/package.json`, "utf8")) as {
      exports?: string | Record<string, unknown>;
    };

    if (!pkg.exports) return true;
    if (typeof pkg.exports === "string") return true;
    return "." in pkg.exports;
  } catch {
    return true;
  }
}

function normalizeForComparison(filePath: string): string {
  return path.resolve(filePath).replaceAll("\\", "/");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceWildcards(pattern: string, replacements: string[]): string {
  let index = 0;
  return pattern.replaceAll("*", () => replacements[index++] ?? "");
}

function exportKeyToSpecifier(pkgName: string, exportKey: string): string | null {
  if (exportKey === ".") return pkgName;
  if (!exportKey.startsWith("./")) return null;
  return `${pkgName}/${exportKey.slice(2)}`;
}

function matchExportTarget(
  pkgName: string,
  exportKey: string,
  target: unknown,
  packageRoot: string,
  absolutePath: string,
): string | null {
  if (typeof target === "string") {
    if (!target.startsWith("./")) return null;

    const normalizedAbsolutePath = normalizeForComparison(absolutePath);
    const normalizedTarget = normalizeForComparison(path.resolve(packageRoot, target));
    if (exportKey.includes("*") && target.includes("*")) {
      const pattern = `^${escapeRegExp(normalizedTarget).replaceAll("\\*", "(.+?)")}$`;
      const match = normalizedAbsolutePath.match(new RegExp(pattern));
      if (!match) return null;
      return exportKeyToSpecifier(pkgName, replaceWildcards(exportKey, match.slice(1)));
    }

    if (normalizedTarget !== normalizedAbsolutePath) return null;
    return exportKeyToSpecifier(pkgName, exportKey);
  }

  if (Array.isArray(target)) {
    for (const item of target) {
      const matched = matchExportTarget(pkgName, exportKey, item, packageRoot, absolutePath);
      if (matched) return matched;
    }
    return null;
  }

  if (typeof target === "object" && target !== null) {
    for (const item of Object.values(target)) {
      const matched = matchExportTarget(pkgName, exportKey, item, packageRoot, absolutePath);
      if (matched) return matched;
    }
  }

  return null;
}

function resolveSpecifierFromExports(
  packageRoot: string,
  pkgName: string,
  absolutePath: string,
): string | null {
  try {
    const pkg = JSON.parse(readFileSync(`${packageRoot}/package.json`, "utf8")) as {
      exports?: unknown;
    };

    if (!pkg.exports) return null;
    if (typeof pkg.exports === "string" || Array.isArray(pkg.exports)) {
      return matchExportTarget(pkgName, ".", pkg.exports, packageRoot, absolutePath);
    }

    if (typeof pkg.exports !== "object" || pkg.exports === null) return null;

    const entries = Object.entries(pkg.exports as Record<string, unknown>);
    const subpathEntries = entries.filter(([key]) => key.startsWith("."));
    const candidates = (subpathEntries.length > 0 ? subpathEntries : entries).sort(([a], [b]) => {
      const aScore = Number(a.includes("*"));
      const bScore = Number(b.includes("*"));
      if (aScore !== bScore) return aScore - bScore;
      return b.length - a.length;
    });

    for (const [exportKey, target] of candidates) {
      const matched = matchExportTarget(pkgName, exportKey, target, packageRoot, absolutePath);
      if (matched) return matched;
    }
  } catch {
    return null;
  }

  return null;
}

const PROXY_MARKER = "virtual:vite-rsc/client-in-server-package-proxy/";

function createExactFileDepId(absolutePath: string): string {
  const digest = createHash("sha1").update(absolutePath).digest("hex");
  return `vinext-client-ref-${digest}`;
}

async function getOptimizedDepIdForSpecifier(
  context: PluginContextLike,
  specifier: string,
  importer: string,
): Promise<string | undefined> {
  const depsOptimizer = getDepsOptimizer(context.environment);
  if (!depsOptimizer) return;

  const resolved = await context.resolve(specifier, importer, { skipSelf: true });
  if (!resolved?.id) return;

  const depInfo = depsOptimizer.registerMissingImport(specifier, resolved.id);
  return depsOptimizer.getOptimizedDepId(depInfo);
}

function getDepsOptimizer(environment: Environment | undefined): DevEnvironment["depsOptimizer"] {
  if (!environment || environment.mode !== "dev") return;
  return environment.depsOptimizer;
}

type PluginContextLike = {
  environment?: Environment;
  resolve(
    id: string,
    importer?: string,
    options?: { skipSelf?: boolean },
  ): Promise<{ id: string } | null | undefined>;
};

/**
 * Intercepts absolute node_modules path imports originating from RSC
 * `client-in-server-package-proxy` virtual modules in the client environment
 * and redirects them through bare specifier imports. This ensures the browser
 * loads the pre-bundled version (from `.vite/deps/`) rather than the raw ESM
 * file, preventing module duplication and broken React contexts.
 *
 * Dev-only — production builds use the SSR manifest which handles this correctly.
 */
export function clientReferenceDedupPlugin(): Plugin {
  let excludeSet = new Set<string>();
  const hasRootExportCache = new Map<string, boolean>();

  return {
    name: "vinext:client-reference-dedup",
    enforce: "pre",
    apply: "serve",

    configResolved(config) {
      // Capture client environment's optimizeDeps.exclude so we don't
      // redirect packages the user explicitly opted out of pre-bundling.
      const clientExclude =
        config.environments?.client?.optimizeDeps?.exclude ?? config.optimizeDeps?.exclude ?? [];
      excludeSet = new Set(clientExclude);
    },

    resolveId: {
      filter: { id: /node_modules/ },
      async handler(id, importer) {
        // Only operate in the client environment
        if (this.environment?.name !== "client") return;

        // Only intercept imports from client-in-server-package-proxy modules
        if (!importer || !importer.includes(PROXY_MARKER)) return;

        // Only handle absolute paths through node_modules
        if (!id.startsWith("/") || !id.includes("/node_modules/")) return;

        if (process.env.VINEXT_DEBUG_RESOLVE === "1") {
          console.log("[vinext:client-reference-dedup:resolveId]", {
            environment: this.environment.name,
            id,
            importer,
          });
        }

        const pkgName = extractPackageName(id);
        if (!pkgName) return;

        // Respect user's optimizeDeps.exclude
        if (excludeSet.has(pkgName)) return;

        const packageRoot = extractPackageRoot(id);
        if (!packageRoot) return;

        const exportedSpecifier = resolveSpecifierFromExports(packageRoot, pkgName, id);
        if (exportedSpecifier) {
          const optimizedId = await getOptimizedDepIdForSpecifier(
            this as PluginContextLike,
            exportedSpecifier,
            importer,
          );
          if (optimizedId) return optimizedId;
        }

        let hasRootExport = hasRootExportCache.get(packageRoot);
        if (hasRootExport === undefined) {
          hasRootExport = packageHasRootExport(packageRoot);
          hasRootExportCache.set(packageRoot, hasRootExport);
        }

        if (!hasRootExport) {
          const depsOptimizer = getDepsOptimizer(this.environment);
          if (!depsOptimizer) return;

          const depId = createExactFileDepId(id);
          const depInfo = depsOptimizer.registerMissingImport(depId, id);
          return depsOptimizer.getOptimizedDepId(depInfo);
        }

        return await getOptimizedDepIdForSpecifier(this as PluginContextLike, pkgName, importer);
      },
    },
  };
}
