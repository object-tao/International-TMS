import { env } from "cloudflare:workers";
import { redirect } from "react-router";
import { randomToken, sha256 } from "./crypto.server";
import type { Site } from "./site.server";

const COOKIE_NAME = "itms_session";

export type SessionUser = {
  sessionId: string;
  userId: string;
  organizationId: string;
  organizationName: string;
  email: string;
  displayName: string;
  site: Site;
  permissions: string[];
};

function cookieValue(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

export async function createSession(userId: string, organizationId: string, site: Site = "admin"): Promise<string> {
  const token = randomToken();
  const tokenHash = await sha256(token);
  const now = new Date();
  const ttl = Math.max(900, Number(env.SESSION_TTL_SECONDS || 28_800));
  const expiresAt = new Date(now.getTime() + ttl * 1000);
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, organization_id, token_hash, expires_at, last_seen_at, created_at, site)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), userId, organizationId, tokenHash, expiresAt.toISOString(), now.toISOString(), now.toISOString(), site)
    .run();
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ttl}`;
}

export async function getSessionUser(request: Request): Promise<SessionUser | null> {
  const token = cookieValue(request, COOKIE_NAME);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(
    `SELECT s.id AS session_id, s.site, u.id AS user_id, u.email, u.display_name,
            o.id AS organization_id, o.name AS organization_name
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       JOIN organizations o ON o.id = s.organization_id
      WHERE s.token_hash = ? AND s.expires_at > ?
        AND u.status = 'active' AND o.status = 'active'
        AND (
          (s.site = 'admin' AND EXISTS (
            SELECT 1 FROM memberships m
            WHERE m.user_id = u.id AND m.organization_id = o.id AND m.status = 'active'
          ))
          OR
          (s.site = 'portal' AND EXISTS (
            SELECT 1 FROM customer_portal_accounts cpa
            WHERE cpa.user_id = u.id AND cpa.organization_id = o.id AND cpa.status = 'active'
          ))
        )`,
  )
    .bind(tokenHash, new Date().toISOString())
    .first<Record<string, string>>();
  if (!row) return null;
  const permissionRows = await env.DB.prepare(
    `SELECT DISTINCT rp.permission_code AS code
       FROM memberships m
       JOIN membership_roles mr ON mr.membership_id = m.id
       JOIN roles r ON r.id = mr.role_id AND r.organization_id = m.organization_id
       JOIN role_permissions rp ON rp.role_id = r.id
      WHERE m.user_id = ? AND m.organization_id = ? AND m.status = 'active'`,
  )
    .bind(row.user_id, row.organization_id)
    .all<{ code: string }>();
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    email: row.email,
    displayName: row.display_name,
    site: row.site as Site,
    permissions: permissionRows.results.map((item) => item.code),
  };
}

export async function requireSessionUser(request: Request, permission?: string, site: Site = "admin"): Promise<SessionUser> {
  const user = await getSessionUser(request);
  if (!user || user.site !== site) throw redirect(site === "portal" ? "/portal/login" : "/login");
  if (permission && !user.permissions.includes(permission)) throw new Response("没有权限执行此操作", { status: 403 });
  return user;
}

export async function destroySession(request: Request): Promise<string> {
  const token = cookieValue(request, COOKIE_NAME);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function isLoginLocked(lockedUntil: string | null | undefined): boolean {
  return Boolean(lockedUntil && new Date(lockedUntil).getTime() > Date.now());
}

export async function recordLoginFailure(userId: string, currentFailures: number): Promise<void> {
  const nextFailures = currentFailures + 1;
  const lockedUntil = nextFailures >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;
  await env.DB.prepare("UPDATE users SET failed_login_count = ?, locked_until = COALESCE(?, locked_until), updated_at = ? WHERE id = ?")
    .bind(nextFailures, lockedUntil, new Date().toISOString(), userId)
    .run();
}

export async function clearLoginFailures(userId: string): Promise<void> {
  await env.DB.prepare("UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = ?, updated_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), new Date().toISOString(), userId)
    .run();
}
