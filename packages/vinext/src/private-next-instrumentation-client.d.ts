declare module "private-next-instrumentation-client" {
  export function onRouterTransitionStart(
    href: string,
    navigationType: "push" | "replace" | "traverse",
  ): void;
}
