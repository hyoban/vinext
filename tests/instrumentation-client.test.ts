import { describe, it, expect, vi, beforeEach, afterEach } from "vite-plus/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("findInstrumentationClientFile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vinext-inst-client-"));
  });

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("prefers src/ over the project root", async () => {
    fs.writeFileSync(path.join(tmpDir, "instrumentation-client.ts"), "");
    fs.mkdirSync(path.join(tmpDir, "src"));
    fs.writeFileSync(path.join(tmpDir, "src", "instrumentation-client.ts"), "");

    const { findInstrumentationClientFile } =
      await import("../packages/vinext/src/server/instrumentation-client.js");

    expect(findInstrumentationClientFile(tmpDir)).toBe(
      path.join(tmpDir, "src", "instrumentation-client.ts"),
    );
  });

  it("falls back to the project root when src/ is absent", async () => {
    fs.writeFileSync(path.join(tmpDir, "instrumentation-client.ts"), "");

    const { findInstrumentationClientFile } =
      await import("../packages/vinext/src/server/instrumentation-client.js");

    expect(findInstrumentationClientFile(tmpDir)).toBe(
      path.join(tmpDir, "instrumentation-client.ts"),
    );
  });

  it("finds instrumentation-client even when pageExtensions would not include .ts", async () => {
    fs.writeFileSync(path.join(tmpDir, "instrumentation-client.ts"), "");

    const { findInstrumentationClientFile } =
      await import("../packages/vinext/src/server/instrumentation-client.js");

    expect(findInstrumentationClientFile(tmpDir)).toBe(
      path.join(tmpDir, "instrumentation-client.ts"),
    );
  });

  it("returns null when no instrumentation-client file exists", async () => {
    const { findInstrumentationClientFile } =
      await import("../packages/vinext/src/server/instrumentation-client.js");

    expect(findInstrumentationClientFile(tmpDir)).toBeNull();
  });
});

describe("client instrumentation runtime", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is a no-op when no module is provided", async () => {
    const { setClientInstrumentationHooks, getClientInstrumentationHooks } =
      await import("../packages/vinext/src/client/instrumentation-client.js");

    expect(setClientInstrumentationHooks()).toBeNull();
    expect(getClientInstrumentationHooks()).toBeNull();
  });

  it("stores onRouterTransitionStart and notifies it later", async () => {
    const {
      setClientInstrumentationHooks,
      getClientInstrumentationHooks,
      notifyRouterTransitionStart,
    } = await import("../packages/vinext/src/client/instrumentation-client.js");
    const onRouterTransitionStart = vi.fn();

    setClientInstrumentationHooks({ onRouterTransitionStart });

    expect(getClientInstrumentationHooks()?.onRouterTransitionStart).toBe(onRouterTransitionStart);

    notifyRouterTransitionStart("/about", "push");
    expect(onRouterTransitionStart).toHaveBeenCalledWith("/about", "push");
  });

  it("supports modules that expose hooks on the default export", async () => {
    const { setClientInstrumentationHooks, getClientInstrumentationHooks } =
      await import("../packages/vinext/src/client/instrumentation-client.js");
    const onRouterTransitionStart = vi.fn();

    setClientInstrumentationHooks({
      default: {
        onRouterTransitionStart,
      },
    });

    expect(getClientInstrumentationHooks()?.onRouterTransitionStart).toBe(onRouterTransitionStart);
  });
});
