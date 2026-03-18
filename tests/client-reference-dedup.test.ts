import path from "node:path";
import { describe, it, expect } from "vite-plus/test";
import {
  extractPackageName,
  clientReferenceDedupPlugin,
} from "../packages/vinext/src/plugins/client-reference-dedup.js";

type HookObject<T extends (...args: any[]) => any> = {
  handler: T;
  filter?: {
    id?: RegExp;
  };
};

function getHookObject<T extends (...args: any[]) => any>(hook: unknown): HookObject<T> {
  if (typeof hook !== "object" || hook === null || !("handler" in hook)) {
    throw new TypeError("expected object hook");
  }

  return hook as HookObject<T>;
}

describe("extractPackageName", () => {
  it("extracts a regular package name", () => {
    expect(extractPackageName("/project/node_modules/react/index.js")).toBe("react");
  });

  it("extracts a scoped package name", () => {
    expect(extractPackageName("/project/node_modules/@mantine/core/esm/MantineProvider.mjs")).toBe(
      "@mantine/core",
    );
  });

  it("handles nested node_modules (uses last segment)", () => {
    expect(extractPackageName("/project/node_modules/foo/node_modules/@bar/baz/lib/index.js")).toBe(
      "@bar/baz",
    );
  });

  it("handles package name with no subpath", () => {
    expect(extractPackageName("/project/node_modules/lodash")).toBe("lodash");
  });

  it("returns null for paths without node_modules", () => {
    expect(extractPackageName("/project/src/components/Foo.tsx")).toBeNull();
  });

  it("returns null for incomplete scoped package", () => {
    expect(extractPackageName("/project/node_modules/@org")).toBeNull();
  });

  it("handles deeply nested submodule paths", () => {
    expect(
      extractPackageName(
        "/project/node_modules/@mantine/core/esm/components/TextInput/TextInput.mjs",
      ),
    ).toBe("@mantine/core");
  });
});

describe("clientReferenceDedupPlugin", () => {
  const plugin = clientReferenceDedupPlugin();
  const load = getHookObject<(id: string) => string | undefined>(plugin.load);
  const proxyId = (id: string) =>
    `${String.fromCharCode(0)}virtual:vite-rsc/client-in-server-package-proxy/${encodeURIComponent(id)}`;

  function createContext(
    envName: string,
    depsOptimizer?: {
      registerMissingImport: (
        id: string,
        resolved: string,
      ) => { file: string; browserHash: string };
      getOptimizedDepId: (depInfo: { file: string; browserHash: string }) => string;
    },
  ) {
    return {
      environment: { mode: "dev" as const, name: envName, depsOptimizer },
    };
  }

  describe("load", () => {
    it("re-exports from the package root when no exact export matches", () => {
      const ctx = createContext("client");
      const result = load.handler.call(
        ctx,
        proxyId("/project/node_modules/@mantine/core/esm/MantineProvider.mjs"),
      );
      expect(result).toContain(`export * from "@mantine/core";`);
    });

    it("skips non-client environments", () => {
      const ctx = createContext("rsc");
      const result = load.handler.call(
        ctx,
        proxyId("/project/node_modules/@mantine/core/esm/MantineProvider.mjs"),
      );
      expect(result).toBeUndefined();
    });

    it("skips ids that are not client proxy modules", () => {
      const ctx = createContext("client");
      const result = load.handler.call(ctx, "/project/src/App.tsx");
      expect(result).toBeUndefined();
    });

    it("skips ids that do not decode to node_modules paths", () => {
      const ctx = createContext("client");
      const result = load.handler.call(ctx, proxyId("/project/src/components/Foo.tsx"));
      expect(result).toBeUndefined();
    });

    it("respects optimizeDeps.exclude from resolved config", () => {
      const excludePlugin = clientReferenceDedupPlugin();
      (excludePlugin.configResolved as any)({
        environments: {
          client: { optimizeDeps: { exclude: ["@mantine/core"] } },
        },
        optimizeDeps: {},
      });
      const excludeLoad = excludePlugin.load as Extract<
        NonNullable<typeof excludePlugin.load>,
        object
      >;
      const excludeLoadHook = getHookObject<(id: string) => string | undefined>(excludeLoad);
      const ctx = createContext("client");
      const result = excludeLoadHook.handler.call(
        ctx,
        proxyId("/project/node_modules/@mantine/core/esm/MantineProvider.mjs"),
      );
      expect(result).toBeUndefined();
    });

    it("falls back to top-level optimizeDeps.exclude", () => {
      const excludePlugin = clientReferenceDedupPlugin();
      (excludePlugin.configResolved as any)({
        optimizeDeps: { exclude: ["some-pkg"] },
      });
      const excludeLoad = excludePlugin.load as Extract<
        NonNullable<typeof excludePlugin.load>,
        object
      >;
      const excludeLoadHook = getHookObject<(id: string) => string | undefined>(excludeLoad);
      const ctx = createContext("client");
      const result = excludeLoadHook.handler.call(
        ctx,
        proxyId("/project/node_modules/some-pkg/dist/index.mjs"),
      );
      expect(result).toBeUndefined();
    });

    it("registers an exact-file optimized dep when the package has no root export", () => {
      const registerMissingImport = (id: string, resolved: string) => ({
        file: `/project/node_modules/.vite/deps/${id}.js`,
        browserHash: "abc123",
        id,
        resolved,
      });
      const getOptimizedDepId = (depInfo: { file: string; browserHash: string }) =>
        `${depInfo.file}?v=${depInfo.browserHash}`;
      const ctx = createContext("client", { registerMissingImport, getOptimizedDepId });
      const rawClientFile = path.join(
        process.cwd(),
        "examples/fumadocs-docs-template/node_modules/fumadocs-ui/dist/layouts/home/client.js",
      );

      const result = load.handler.call(ctx, proxyId(rawClientFile));
      expect(result).toContain(
        `export * from "/project/node_modules/.vite/deps/vinext-client-ref-`,
      );
      expect(result).toMatch(/vinext-client-ref-[a-f0-9]{40}\.js\?v=abc123/);
    });

    it("falls back to the raw file when exact-file fallback cannot be optimized", () => {
      const ctx = createContext("client");
      const rawClientFile = path.join(
        process.cwd(),
        "examples/fumadocs-docs-template/node_modules/fumadocs-ui/dist/layouts/home/client.js",
      );
      const result = load.handler.call(ctx, proxyId(rawClientFile));
      expect(result).toContain(`export * from ${JSON.stringify(rawClientFile)};`);
    });

    it("prefers an exact exported subpath when the file matches a static export target", () => {
      const ctx = createContext("client");
      const exportedFile = path.join(
        process.cwd(),
        "examples/fumadocs-docs-template/node_modules/fumadocs-ui/dist/layouts/home/index.js",
      );
      const result = load.handler.call(ctx, proxyId(exportedFile));
      expect(result).toContain(`export * from "fumadocs-ui/layouts/home";`);
    });

    it("prefers an exact exported subpath when the file matches a pattern export target", () => {
      const ctx = createContext("client");
      const exportedFile = path.join(
        process.cwd(),
        "examples/fumadocs-docs-template/node_modules/fumadocs-ui/dist/provider/next.js",
      );
      const result = load.handler.call(ctx, proxyId(exportedFile));
      expect(result).toContain(`export * from "fumadocs-ui/provider/next";`);
    });

    it("declares a client proxy filter", () => {
      expect(load.filter?.id?.source).toContain("client-in-server-package-proxy");
    });
  });

  describe("plugin metadata", () => {
    it("has correct name", () => {
      expect(plugin.name).toBe("vinext:client-reference-dedup");
    });

    it("enforces pre", () => {
      expect(plugin.enforce).toBe("pre");
    });

    it("applies only in serve mode", () => {
      expect(plugin.apply).toBe("serve");
    });

    it("registers a load hook", () => {
      expect(plugin.load).toBeDefined();
    });

    it("does not register a resolveId hook", () => {
      expect(plugin.resolveId).toBeUndefined();
    });
  });
});
