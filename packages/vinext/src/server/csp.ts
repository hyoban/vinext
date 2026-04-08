const ESCAPE_REGEX = /[&><\u2028\u2029]/;

export function getScriptNonceFromHeader(cspHeaderValue: string): string | undefined {
  const directives = cspHeaderValue.split(";").map((directive) => directive.trim());

  const directive =
    directives.find((value) => value.startsWith("script-src")) ??
    directives.find((value) => value.startsWith("default-src"));

  if (!directive) {
    return undefined;
  }

  const nonce = directive
    .split(" ")
    .slice(1)
    .map((source) => source.trim())
    .find((source) => source.startsWith("'nonce-") && source.length > 8 && source.endsWith("'"))
    ?.slice(7, -1);

  if (!nonce) {
    return undefined;
  }

  if (ESCAPE_REGEX.test(nonce)) {
    throw new Error("Nonce value from Content-Security-Policy contained HTML escape characters.");
  }

  return nonce;
}

export function getScriptNonceFromHeaders(headers: Headers | null | undefined): string | undefined {
  const csp =
    headers?.get("content-security-policy") ?? headers?.get("content-security-policy-report-only");

  if (!csp) {
    return undefined;
  }

  return getScriptNonceFromHeader(csp);
}
