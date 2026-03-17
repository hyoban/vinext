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
  const resolveId = getHookObject<(id: string, importer?: string) => Promise<string | undefined>>(
    plugin.resolveId,
  );

  function createContext(
    envName: string,
    depsOptimizer?: {
      registerMissingImport: (
        id: string,
        resolved: string,
      ) => { file: string; browserHash: string };
      getOptimizedDepId: (depInfo: { file: string; browserHash: string }) => string;
    },
    resolve: (
      id: string,
      importer?: string,
      options?: { skipSelf?: boolean },
    ) => Promise<{ id: string } | null | undefined> = async (id) => ({ id }),
  ) {
    return {
      environment: { mode: "dev" as const, name: envName, depsOptimizer },
      resolve,
    };
  }

  describe("resolveId", () => {
    it("uses the resolved canonical id even when the client environment has no deps optimizer", async () => {
      const ctx = createContext("client");
      const result = await resolveId.handler.call(
        ctx,
        "/project/node_modules/@mantine/core/esm/MantineProvider.mjs",
        "\0virtual:vite-rsc/client-in-server-package-proxy/abc123",
      );
      expect(result).toBe("@mantine/core");
    });

    it("falls back to the package root optimized dep when no exact export matches", async () => {
      let resolvedId = "";
      const registerMissingImport = (id: string, resolved: string) => {
        resolvedId = resolved;
        return {
          file: `/project/node_modules/.vite/deps/${id}.js`,
          browserHash: "abc123",
        };
      };
      const getOptimizedDepId = (depInfo: { file: string; browserHash: string }) =>
        `${depInfo.file}?v=${depInfo.browserHash}`;
      const ctx = createContext(
        "client",
        { registerMissingImport, getOptimizedDepId },
        async () => ({ id: "/@fs/project/node_modules/@mantine/core/index.js?v=abc123" }),
      );

      const result = await resolveId.handler.call(
        ctx,
        "/project/node_modules/@mantine/core/esm/MantineProvider.mjs",
        "\0virtual:vite-rsc/client-in-server-package-proxy/abc123",
      );
      expect(result).toBe("/project/node_modules/.vite/deps/@mantine/core.js?v=abc123");
      expect(resolvedId).toBe("/project/node_modules/@mantine/core/index.js");
    });

    it("skips non-client environments", async () => {
      const ctx = createContext("rsc");
      const result = await resolveId.handler.call(
        ctx,
        "/project/node_modules/@mantine/core/esm/MantineProvider.mjs",
        "\0virtual:vite-rsc/client-in-server-package-proxy/abc123",
      );
      expect(result).toBeUndefined();
    });

    it("skips imports not from proxy modules", async () => {
      const ctx = createContext("client");
      const result = await resolveId.handler.call(
        ctx,
        "/project/node_modules/@mantine/core/esm/MantineProvider.mjs",
        "/project/src/App.tsx",
      );
      expect(result).toBeUndefined();
    });

    it("skips non-absolute paths", async () => {
      const ctx = createContext("client");
      const result = await resolveId.handler.call(
        ctx,
        "@mantine/core",
        "\0virtual:vite-rsc/client-in-server-package-proxy/abc123",
      );
      expect(result).toBeUndefined();
    });

    it("skips paths without node_modules", async () => {
      const ctx = createContext("client");
      const result = await resolveId.handler.call(
        ctx,
        "/project/src/components/Foo.tsx",
        "\0virtual:vite-rsc/client-in-server-package-proxy/abc123",
      );
      expect(result).toBeUndefined();
    });

    it("skips when importer is undefined", async () => {
      const ctx = createContext("client");
      const result = await resolveId.handler.call(
        ctx,
        "/project/node_modules/react/index.js",
        undefined,
      );
      expect(result).toBeUndefined();
    });

    it("respects optimizeDeps.exclude from resolved config", async () => {
      const excludePlugin = clientReferenceDedupPlugin();
      // Simulate configResolved with @mantine/core excluded
      (excludePlugin.configResolved as any)({
        environments: {
          client: { optimizeDeps: { exclude: ["@mantine/core"] } },
        },
        optimizeDeps: {},
      });
      const excludeResolveId = excludePlugin.resolveId as Extract<
        NonNullable<typeof excludePlugin.resolveId>,
        object
      >;
      const excludeResolveIdHook =
        getHookObject<(id: string, importer?: string) => Promise<string | undefined>>(
          excludeResolveId,
        );
      const ctx = createContext("client");
      const result = await excludeResolveIdHook.handler.call(
        ctx,
        "/project/node_modules/@mantine/core/esm/MantineProvider.mjs",
        "\0virtual:vite-rsc/client-in-server-package-proxy/abc123",
      );
      expect(result).toBeUndefined();
    });

    it("falls back to top-level optimizeDeps.exclude", async () => {
      const excludePlugin = clientReferenceDedupPlugin();
      (excludePlugin.configResolved as any)({
        optimizeDeps: { exclude: ["some-pkg"] },
      });
      const excludeResolveId = excludePlugin.resolveId as Extract<
        NonNullable<typeof excludePlugin.resolveId>,
        object
      >;
      const excludeResolveIdHook =
        getHookObject<(id: string, importer?: string) => Promise<string | undefined>>(
          excludeResolveId,
        );
      const ctx = createContext("client");
      const result = await excludeResolveIdHook.handler.call(
        ctx,
        "/project/node_modules/some-pkg/dist/index.mjs",
        "\0virtual:vite-rsc/client-in-server-package-proxy/abc123",
      );
      expect(result).toBeUndefined();
    });

    it("registers an exact-file optimized dep when the package has no root export", async () => {
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

      const result = await resolveId.handler.call(
        ctx,
        rawClientFile,
        "\0virtual:vite-rsc/client-in-server-package-proxy/abc123",
      );

      expect(result).toContain("/node_modules/.vite/deps/vinext-client-ref-");
      expect(result).toMatch(/vinext-client-ref-[a-f0-9]{40}\.js\?v=abc123$/);
    });

    it("prefers an exact exported subpath when the file matches a static export target", async () => {
      let resolvedId = "";
      const registerMissingImport = (id: string, resolved: string) => {
        resolvedId = resolved;
        return {
          file: `/project/node_modules/.vite/deps/${id}.js`,
          browserHash: "abc123",
        };
      };
      const getOptimizedDepId = (depInfo: { file: string; browserHash: string }) =>
        `${depInfo.file}?v=${depInfo.browserHash}`;
      const ctx = createContext(
        "client",
        { registerMissingImport, getOptimizedDepId },
        async () => ({
          id: "/@fs/project/node_modules/fumadocs-ui/dist/layouts/home/index.js?v=abc123",
        }),
      );
      const exportedFile = path.join(
        process.cwd(),
        "examples/fumadocs-docs-template/node_modules/fumadocs-ui/dist/layouts/home/index.js",
      );

      const result = await resolveId.handler.call(
        ctx,
        exportedFile,
        "\0virtual:vite-rsc/client-in-server-package-proxy/abc123",
      );
      expect(result).toBe("/project/node_modules/.vite/deps/fumadocs-ui/layouts/home.js?v=abc123");
      expect(resolvedId).toBe("/project/node_modules/fumadocs-ui/dist/layouts/home/index.js");
    });

    it("prefers an exact exported subpath when the file matches a pattern export target", async () => {
      let resolvedId = "";
      const registerMissingImport = (id: string, resolved: string) => {
        resolvedId = resolved;
        return {
          file: `/project/node_modules/.vite/deps/${id}.js`,
          browserHash: "abc123",
        };
      };
      const getOptimizedDepId = (depInfo: { file: string; browserHash: string }) =>
        `${depInfo.file}?v=${depInfo.browserHash}`;
      const ctx = createContext(
        "client",
        { registerMissingImport, getOptimizedDepId },
        async () => ({
          id: "/@fs/project/node_modules/fumadocs-ui/dist/provider/next.js?v=abc123",
        }),
      );
      const exportedFile = path.join(
        process.cwd(),
        "examples/fumadocs-docs-template/node_modules/fumadocs-ui/dist/provider/next.js",
      );

      const result = await resolveId.handler.call(
        ctx,
        exportedFile,
        "\0virtual:vite-rsc/client-in-server-package-proxy/abc123",
      );
      expect(result).toBe("/project/node_modules/.vite/deps/fumadocs-ui/provider/next.js?v=abc123");
      expect(resolvedId).toBe("/project/node_modules/fumadocs-ui/dist/provider/next.js");
    });

    it("declares a node_modules filter", () => {
      expect(resolveId.filter?.id?.source).toBe("node_modules");
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

    it("does not register a load hook", () => {
      expect(plugin.load).toBeUndefined();
    });
  });
});
