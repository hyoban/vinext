import type { ViteDevServer } from "vite";
import { describe, expect, it } from "vite-plus/test";
import {
  decodeVlqSegment,
  mapStackLine,
  originalPositionFor,
  resolveSourceFile,
  type SourceMapPayload,
} from "../packages/vinext/src/server/dev-stack-sourcemap.js";

const SOURCE_MAP = {
  sources: ["./original.tsx"],
  mappings: "AAAA,KASE",
} satisfies SourceMapPayload;

function createServer(sourceMap: SourceMapPayload | null = SOURCE_MAP): {
  server: ViteDevServer;
  transformRequests: string[];
} {
  const transformRequests: string[] = [];
  const server = {
    environments: {
      client: {
        async transformRequest(viteUrl: string) {
          transformRequests.push(viteUrl);
          return { map: sourceMap };
        },
      },
    },
  } as unknown as ViteDevServer;

  return { server, transformRequests };
}

describe("decodeVlqSegment", () => {
  it("decodes base64 VLQ source-map segments", () => {
    expect(decodeVlqSegment("AAAA")).toEqual([0, 0, 0, 0]);
    expect(decodeVlqSegment("KACE")).toEqual([5, 0, 1, 2]);
    expect(decodeVlqSegment("GACD")).toEqual([3, 0, 1, -1]);
  });

  it("returns an empty segment for invalid VLQ characters", () => {
    expect(decodeVlqSegment("$")).toEqual([]);
  });
});

describe("originalPositionFor", () => {
  it("uses the nearest mapped segment at or before the generated column", () => {
    const sourceMap = {
      sources: ["source.tsx"],
      mappings: "AAAA,KACE,GACD",
    } satisfies SourceMapPayload;

    expect(originalPositionFor(sourceMap, 1, 1)).toEqual({
      source: "source.tsx",
      line: 1,
      column: 1,
    });
    expect(originalPositionFor(sourceMap, 1, 7)).toEqual({
      source: "source.tsx",
      line: 2,
      column: 3,
    });
    expect(originalPositionFor(sourceMap, 1, 9)).toEqual({
      source: "source.tsx",
      line: 3,
      column: 2,
    });
  });

  it("treats single-field generated-only segments as unmapped ranges", () => {
    const sourceMap = {
      sources: ["source.tsx"],
      mappings: "AAAA,KACE,C,GACD",
    } satisfies SourceMapPayload;

    expect(originalPositionFor(sourceMap, 1, 7)).toBeNull();
    expect(originalPositionFor(sourceMap, 1, 10)).toEqual({
      source: "source.tsx",
      line: 3,
      column: 2,
    });
  });

  it("resets generated columns per line while carrying original fields across lines", () => {
    const sourceMap = {
      sources: ["source.tsx"],
      mappings: "AAAA,KACE;AACA",
    } satisfies SourceMapPayload;

    expect(originalPositionFor(sourceMap, 2, 1)).toEqual({
      source: "source.tsx",
      line: 3,
      column: 3,
    });
  });
});

describe("mapStackLine", () => {
  const cases = [
    {
      name: "V8 paren frames",
      input: "    at onClick (http://localhost:5173/src/App.tsx?t=1:1:6)",
      expected: "    at onClick (http://localhost:5173/src/original.tsx:10:3)",
    },
    {
      name: "V8 bare frames",
      input: "    at http://localhost:5173/src/App.tsx?t=1:1:6",
      expected: "    at http://localhost:5173/src/original.tsx:10:3",
    },
    {
      name: "Moz frames",
      input: "onClick@http://localhost:5173/src/App.tsx?t=1:1:6",
      expected: "onClick@http://localhost:5173/src/original.tsx:10:3",
    },
  ];

  for (const { name, input, expected } of cases) {
    it(`maps ${name}`, async () => {
      const { server, transformRequests } = createServer();

      await expect(
        mapStackLine(
          server,
          input,
          "localhost:5173",
          new Map<string, Promise<SourceMapPayload | null>>(),
        ),
      ).resolves.toBe(expected);
      expect(transformRequests).toEqual(["/src/App.tsx?t=1"]);
    });
  }

  it("leaves frames unchanged when the generated URL host does not match the request host", async () => {
    const { server, transformRequests } = createServer();
    const line = "    at onClick (http://evil.test/src/App.tsx?t=1:1:6)";

    await expect(
      mapStackLine(
        server,
        line,
        "localhost:5173",
        new Map<string, Promise<SourceMapPayload | null>>(),
      ),
    ).resolves.toBe(line);
    expect(transformRequests).toEqual([]);
  });
});

describe("resolveSourceFile", () => {
  it("resolves relative sources against the generated URL", () => {
    expect(
      resolveSourceFile(
        "./original.tsx",
        { sources: [], mappings: "AAAA" },
        new URL("http://localhost:5173/src/App.tsx?t=1"),
      ),
    ).toBe("http://localhost:5173/src/original.tsx");
  });

  it("resolves sourceRoot before source paths", () => {
    expect(
      resolveSourceFile(
        "src/page.tsx",
        { sources: [], sourceRoot: "file:///repo/app", mappings: "AAAA" },
        new URL("http://localhost:5173/generated/chunk.js"),
      ),
    ).toBe("file:///repo/app/src/page.tsx");
  });
});
