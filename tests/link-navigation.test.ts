import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import ReactDOMServer from "react-dom/server";
import type { ElementType, ReactNode } from "react";

type CapturedClickEvent = {
  altKey?: boolean;
  button: number;
  ctrlKey?: boolean;
  currentTarget: { target: string };
  defaultPrevented: boolean;
  metaKey?: boolean;
  preventDefault(): void;
  shiftKey?: boolean;
};

type CapturedAnchorProps = {
  onClick?: (event: CapturedClickEvent) => void | Promise<void>;
};

afterEach(() => {
  vi.doUnmock("react");
  vi.doUnmock("react/jsx-runtime");
  vi.doUnmock("react/jsx-dev-runtime");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Link App Router navigation scheduling", () => {
  it("clicking an RSC Link starts app-router navigation inside a React transition", async () => {
    vi.resetModules();

    let capturedAnchorProps: CapturedAnchorProps | undefined;
    let transitionActive = false;
    const transitionStates: boolean[] = [];
    const startTransition = vi.fn((callback: () => void) => {
      transitionActive = true;
      try {
        callback();
      } finally {
        transitionActive = false;
      }
    });

    const captureAnchor = (type: unknown, props: unknown) => {
      if (type === "a" && props !== null && typeof props === "object") {
        capturedAnchorProps = props;
      }
    };

    vi.doMock("react", async () => {
      const actual = await vi.importActual<typeof import("react")>("react");
      const createElement = ((
        type: ElementType,
        props: Record<string, unknown> | null,
        ...children: ReactNode[]
      ) => {
        captureAnchor(type, props);
        return actual.createElement(type, props, ...children);
      }) as typeof actual.createElement;

      return {
        ...actual,
        createElement,
        default: { ...actual, createElement, startTransition },
        startTransition,
      };
    });

    vi.doMock("react/jsx-runtime", async () => {
      const actual = await vi.importActual<typeof import("react/jsx-runtime")>("react/jsx-runtime");
      return {
        ...actual,
        jsx(type: ElementType, props: Record<string, unknown>, key?: string) {
          captureAnchor(type, props);
          return actual.jsx(type, props, key);
        },
        jsxs(type: ElementType, props: Record<string, unknown>, key?: string) {
          captureAnchor(type, props);
          return actual.jsxs(type, props, key);
        },
      };
    });

    vi.doMock("react/jsx-dev-runtime", async () => {
      const actual =
        await vi.importActual<typeof import("react/jsx-dev-runtime")>("react/jsx-dev-runtime");
      return {
        ...actual,
        jsxDEV(
          type: ElementType,
          props: Record<string, unknown>,
          key?: string,
          isStaticChildren?: boolean,
          source?: Parameters<typeof actual.jsxDEV>[4],
          self?: Parameters<typeof actual.jsxDEV>[5],
        ) {
          captureAnchor(type, props);
          return actual.jsxDEV(type, props, key, isStaticChildren ?? false, source, self);
        },
      };
    });

    const navigate = vi.fn(async () => {
      transitionStates.push(transitionActive);
    });
    vi.stubGlobal("window", {
      __VINEXT_RSC_NAVIGATE__: navigate,
      addEventListener: vi.fn(),
      history: {
        pushState: vi.fn(),
        replaceState: vi.fn(),
      },
      location: {
        href: "https://example.com/current",
        origin: "https://example.com",
      },
      scrollTo: vi.fn(),
    });

    const [{ default: IsolatedLink }, React] = await Promise.all([
      import("../packages/vinext/src/shims/link.js"),
      vi.importActual<typeof import("react")>("react"),
    ]);

    ReactDOMServer.renderToString(
      React.createElement(IsolatedLink, { href: "/target", prefetch: false }, "target"),
    );

    const clickEvent = {
      button: 0,
      currentTarget: { target: "" },
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
    };
    const onClick = capturedAnchorProps?.onClick;
    expect(onClick).toBeTypeOf("function");
    if (onClick === undefined) {
      throw new Error("Expected rendered Link anchor to expose an onClick handler");
    }
    await onClick(clickEvent);

    expect(clickEvent.defaultPrevented).toBe(true);
    expect(startTransition).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/target", 0, "navigate", "push", undefined, true);
    expect(transitionStates).toEqual([true]);
  });
});
