import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { DevEnvironment, Environment, Plugin } from "vite";

const NODE_MODULES_SEGMENT = "/node_modules/";
const NODE_MODULES_FILTER = /node_modules/;
const PROXY_MARKER = "virtual:vite-rsc/client-in-server-package-proxy/";

type PackagePathInfo = {
  packageName: string;
  packageRoot: string;
};

type PackageMetadata = {
  exports: unknown;
  hasRootExport: boolean;
};

/**
 * Extract the bare package name from an absolute file path containing node_modules.
 *
 * Handles scoped packages (`@org/name`) and nested node_modules.
 * Returns `null` if the path doesn't contain `/node_modules/`.
 */
export function extractPackageName(absolutePath: string): string | null {
  return getPackagePathInfo(absolutePath)?.packageName ?? null;
}

function getPackagePathInfo(absolutePath: string): PackagePathInfo | null {
  const lastIdx = absolutePath.lastIndexOf(NODE_MODULES_SEGMENT);
  if (lastIdx === -1) return null;

  const packageRootPrefix = absolutePath.slice(0, lastIdx + NODE_MODULES_SEGMENT.length);
  const rest = absolutePath.slice(lastIdx + NODE_MODULES_SEGMENT.length);
  const parts = rest.split("/");
  const [firstPart, secondPart] = parts;

  if (!firstPart) return null;
  if (firstPart.startsWith("@")) {
    if (!secondPart) return null;
    return {
      packageName: `${firstPart}/${secondPart}`,
      packageRoot: `${packageRootPrefix}${firstPart}/${secondPart}`,
    };
  }

  return {
    packageName: firstPart,
    packageRoot: `${packageRootPrefix}${firstPart}`,
  };
}

function readPackageMetadata(packageRoot: string): PackageMetadata {
  try {
    const pkg = JSON.parse(readFileSync(`${packageRoot}/package.json`, "utf8")) as {
      exports?: unknown;
    };

    if (!pkg.exports) {
      return {
        exports: undefined,
        hasRootExport: true,
      };
    }

    return {
      exports: pkg.exports,
      hasRootExport:
        typeof pkg.exports === "string" ||
        Array.isArray(pkg.exports) ||
        (typeof pkg.exports === "object" && pkg.exports !== null && "." in pkg.exports),
    };
  } catch {
    return {
      exports: undefined,
      hasRootExport: true,
    };
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

function resolveExportTargetMatch(
  exportKey: string,
  target: unknown,
  packageRoot: string,
  absolutePath: string,
): string[] | null {
  if (typeof target === "string") {
    if (!target.startsWith("./")) return null;

    const normalizedAbsolutePath = normalizeForComparison(absolutePath);
    const normalizedTarget = normalizeForComparison(path.resolve(packageRoot, target));
    if (exportKey.includes("*") && target.includes("*")) {
      const pattern = `^${escapeRegExp(normalizedTarget).replaceAll("\\*", "(.+?)")}$`;
      return normalizedAbsolutePath.match(new RegExp(pattern))?.slice(1) ?? null;
    }

    return normalizedTarget === normalizedAbsolutePath ? [] : null;
  }

  if (Array.isArray(target)) {
    for (const item of target) {
      const matched = resolveExportTargetMatch(exportKey, item, packageRoot, absolutePath);
      if (matched) return matched;
    }
    return null;
  }

  if (typeof target === "object" && target !== null) {
    for (const item of Object.values(target)) {
      const matched = resolveExportTargetMatch(exportKey, item, packageRoot, absolutePath);
      if (matched) return matched;
    }
  }

  return null;
}

function resolveSpecifierFromExports(
  packageName: string,
  packageRoot: string,
  packageExports: unknown,
  absolutePath: string,
): string | null {
  if (!packageExports) return null;

  const entries =
    typeof packageExports === "string" ||
    Array.isArray(packageExports) ||
    typeof packageExports !== "object" ||
    packageExports === null
      ? [[".", packageExports] satisfies [string, unknown]]
      : Object.entries(packageExports as Record<string, unknown>);

  const subpathEntries = entries.filter(([key]) => key.startsWith("."));
  const candidates = (subpathEntries.length > 0 ? subpathEntries : entries).sort(([a], [b]) => {
    const aScore = Number(a.includes("*"));
    const bScore = Number(b.includes("*"));
    if (aScore !== bScore) return aScore - bScore;
    return b.length - a.length;
  });

  for (const [exportKey, target] of candidates) {
    const matched = resolveExportTargetMatch(exportKey, target, packageRoot, absolutePath);
    if (!matched) continue;
    if (exportKey === ".") return packageName;
    if (!exportKey.startsWith("./")) continue;
    return `${packageName}/${replaceWildcards(exportKey.slice(2), matched)}`;
  }

  return null;
}

function createExactFileDepId(absolutePath: string): string {
  const digest = createHash("sha1").update(absolutePath).digest("hex");
  return `vinext-client-ref-${digest}`;
}

function normalizeResolvedFileId(id: string): string {
  const withoutQuery = id.split("?")[0]?.split("#")[0] ?? id;
  return withoutQuery.startsWith("/@fs/") ? withoutQuery.slice("/@fs".length) : withoutQuery;
}

function getCanonicalSpecifiers(
  packageName: string,
  packageRoot: string,
  packageMetadata: PackageMetadata,
  absolutePath: string,
): string[] {
  const specifiers: string[] = [];
  const exportedSpecifier = resolveSpecifierFromExports(
    packageName,
    packageRoot,
    packageMetadata.exports,
    absolutePath,
  );
  if (exportedSpecifier) specifiers.push(exportedSpecifier);
  if (packageMetadata.hasRootExport && exportedSpecifier !== packageName) {
    specifiers.push(packageName);
  }
  return specifiers;
}

async function getCanonicalClientReferenceId(
  context: PluginContextLike,
  specifiers: readonly string[],
  importer: string,
  absolutePath: string,
  allowExactFileFallback: boolean,
): Promise<string | undefined> {
  const depsOptimizer = getDepsOptimizer(context.environment);
  for (const specifier of specifiers) {
    const resolved = await context.resolve(specifier, importer, { skipSelf: true });
    if (!resolved?.id) continue;
    if (!depsOptimizer) return resolved.id;

    const depInfo = depsOptimizer.registerMissingImport(
      specifier,
      normalizeResolvedFileId(resolved.id),
    );
    return depsOptimizer.getOptimizedDepId(depInfo);
  }

  if (!allowExactFileFallback || !depsOptimizer) return;
  const depInfo = depsOptimizer.registerMissingImport(
    createExactFileDepId(absolutePath),
    absolutePath,
  );
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
  const packageMetadataCache = new Map<string, PackageMetadata>();

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
      filter: { id: NODE_MODULES_FILTER },
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

        const packageInfo = getPackagePathInfo(id);
        if (!packageInfo) return;
        const { packageName, packageRoot } = packageInfo;

        // Respect user's optimizeDeps.exclude
        if (excludeSet.has(packageName)) return;

        let packageMetadata = packageMetadataCache.get(packageRoot);
        if (!packageMetadata) {
          packageMetadata = readPackageMetadata(packageRoot);
          packageMetadataCache.set(packageRoot, packageMetadata);
        }

        return await getCanonicalClientReferenceId(
          this as PluginContextLike,
          getCanonicalSpecifiers(packageName, packageRoot, packageMetadata, id),
          importer,
          id,
          !packageMetadata.hasRootExport,
        );
      },
    },
  };
}
