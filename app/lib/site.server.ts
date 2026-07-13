export type Site = "admin" | "portal";

export function siteFromRequest(request: Request): Site {
  const hostname = new URL(request.url).hostname.toLowerCase();
  return hostname === "portal.oulingtruck.com" || hostname.startsWith("portal.") ? "portal" : "admin";
}

export function siteHome(site: Site): string {
  return site === "portal" ? "/portal" : "/admin";
}

export function siteLogin(site: Site): string {
  return site === "portal" ? "/portal/login" : "/login";
}
