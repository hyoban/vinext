import { buildRouteTrie, trieMatch } from "../routing/route-trie.js";
import { matchRoutePattern, type RoutePatternParams } from "../routing/route-pattern.js";
import { normalizePathnameForRouteMatch } from "../routing/utils.js";

type AppRscRouteParams = RoutePatternParams;

type AppRscInterceptForMatching = {
  targetPattern: string;
  interceptLayouts: readonly unknown[];
  page: unknown;
  params: readonly string[];
};

type AppRscSlotForMatching = {
  id?: string | null;
  intercepts?: readonly AppRscInterceptForMatching[];
};

type AppRscRouteForMatching = {
  patternParts: string[];
  slots?: Record<string, AppRscSlotForMatching>;
};

type AppRscInterceptMatch = AppRscInterceptLookupEntry & {
  matchedParams: AppRscRouteParams;
};

type AppRscInterceptLookupEntry = {
  sourceRouteIndex: number;
  slotKey: string;
  targetPattern: string;
  targetPatternParts: string[];
  interceptLayouts: readonly unknown[];
  page: unknown;
  params: readonly string[];
  slotId: string | null;
};

function createRouteParams(): AppRscRouteParams {
  return Object.create(null);
}

function appRscPathnameParts(pathname: string): string[] {
  const pathOnly = pathname.split("?")[0];
  const normalized = pathOnly === "/" ? "/" : pathOnly.replace(/\/$/, "");
  return normalizePathnameForRouteMatch(normalized).split("/").filter(Boolean);
}

export function createAppRscRouteMatcher<Route extends AppRscRouteForMatching>(
  routes: Route[],
): {
  matchRoute(url: string): { route: Route; params: AppRscRouteParams } | null;
  findIntercept(pathname: string, sourcePathname?: string | null): AppRscInterceptMatch | null;
} {
  const routeTrie = buildRouteTrie(routes);
  const interceptLookup = createInterceptLookup(routes);

  return {
    matchRoute(url) {
      return trieMatch(routeTrie, appRscPathnameParts(url));
    },
    findIntercept(pathname, sourcePathname = null) {
      if (sourcePathname === null) return null;
      const urlParts = appRscPathnameParts(pathname);
      const sourceParts = appRscPathnameParts(sourcePathname);
      for (const entry of interceptLookup) {
        const params = matchAppRscRoutePattern(urlParts, entry.targetPatternParts);
        if (params !== null) {
          const sourceRoute = routes[entry.sourceRouteIndex];
          const sourceParams = sourceRoute
            ? matchAppRscRoutePattern(sourceParts, sourceRoute.patternParts)
            : null;
          if (sourceParams === null) continue;
          return { ...entry, matchedParams: mergeMatchedParams(sourceParams, params) };
        }
      }
      return null;
    },
  };
}

function createInterceptLookup<Route extends AppRscRouteForMatching>(
  routes: Route[],
): AppRscInterceptLookupEntry[] {
  const interceptLookup: AppRscInterceptLookupEntry[] = [];
  for (let routeIndex = 0; routeIndex < routes.length; routeIndex++) {
    const route = routes[routeIndex];
    if (!route.slots) continue;
    for (const [slotKey, slotModule] of Object.entries(route.slots)) {
      if (!slotModule.intercepts) continue;
      for (const intercept of slotModule.intercepts) {
        interceptLookup.push({
          sourceRouteIndex: routeIndex,
          slotKey,
          slotId: typeof slotModule.id === "string" ? slotModule.id : null,
          targetPattern: intercept.targetPattern,
          targetPatternParts: intercept.targetPattern.split("/").filter(Boolean),
          interceptLayouts: intercept.interceptLayouts,
          page: intercept.page,
          params: intercept.params,
        });
      }
    }
  }
  return interceptLookup;
}

export function matchAppRscRoutePattern(
  urlParts: string[],
  patternParts: string[],
): AppRscRouteParams | null {
  return matchRoutePattern(urlParts, patternParts);
}

function mergeMatchedParams(
  sourceParams: AppRscRouteParams,
  targetParams: AppRscRouteParams,
): AppRscRouteParams {
  return Object.assign(createRouteParams(), sourceParams, targetParams);
}
