import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { DevEnvironment, Environment, Plugin } from "vite";

const NODE_MODULES_SEGMENT = "/node_modules/";
const CLIENT_PROXY_PREFIX =
  String.fromCharCode(0) + "virtual:vite-rsc/client-in-server-package-proxy/";
const CLIENT_PROXY_FILTER = new RegExp(`^${escapeRegExp(CLIENT_PROXY_PREFIX)}`);

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

function renderClientProxy(source: string): string {
  return `
export * from ${JSON.stringify(source)};
import * as __all__ from ${JSON.stringify(source)};
export default __all__.default;
`;
}

function decodeClientProxyId(id: string): string | null {
  if (!id.startsWith(CLIENT_PROXY_PREFIX)) return null;
  return decodeURIComponent(id.slice(CLIENT_PROXY_PREFIX.length));
}

function getExactFileFallbackSource(
  environment: Environment | undefined,
  absolutePath: string,
): string | undefined {
  const depsOptimizer = getDepsOptimizer(environment);
  if (!depsOptimizer) return absolutePath;

  const depInfo = depsOptimizer.registerMissingImport(
    createExactFileDepId(absolutePath),
    absolutePath,
  );
  return depsOptimizer.getOptimizedDepId(depInfo);
}

function getCanonicalClientReferenceSource(
  environment: Environment | undefined,
  specifiers: readonly string[],
  absolutePath: string,
  allowExactFileFallback: boolean,
): string | undefined {
  if (specifiers.length > 0) return specifiers[0];
  if (!allowExactFileFallback) return;
  return getExactFileFallbackSource(environment, absolutePath);
}

function getDepsOptimizer(environment: Environment | undefined): DevEnvironment["depsOptimizer"] {
  if (!environment || environment.mode !== "dev") return;
  return environment.depsOptimizer;
}

/**
 * Overrides vite-plugin-rsc's dev-only `client-in-server-package-proxy` virtual
 * modules so they re-export from canonical client sources instead of raw
 * node_modules file paths.
 *
 * This keeps client references aligned with the browser environment's normal
 * module graph and avoids duplicate React contexts.
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

    load: {
      filter: { id: CLIENT_PROXY_FILTER },
      handler(id) {
        if (this.environment?.name !== "client") return;
        const absolutePath = decodeClientProxyId(id);
        if (!absolutePath || !absolutePath.includes(NODE_MODULES_SEGMENT)) return;
        if (process.env.VINEXT_DEBUG_RESOLVE === "1") {
          console.log("[vinext:client-reference-dedup:load]", {
            environment: this.environment.name,
            id: absolutePath,
            proxyId: id,
          });
        }

        const packageInfo = getPackagePathInfo(absolutePath);
        if (!packageInfo) return;
        const { packageName, packageRoot } = packageInfo;

        if (excludeSet.has(packageName)) return;

        let packageMetadata = packageMetadataCache.get(packageRoot);
        if (!packageMetadata) {
          packageMetadata = readPackageMetadata(packageRoot);
          packageMetadataCache.set(packageRoot, packageMetadata);
        }

        const source = getCanonicalClientReferenceSource(
          this.environment,
          getCanonicalSpecifiers(packageName, packageRoot, packageMetadata, absolutePath),
          absolutePath,
          !packageMetadata.hasRootExport,
        );
        if (!source) return;
        return renderClientProxy(source);
      },
    },
  };
}
