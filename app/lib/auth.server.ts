import { env } from "cloudflare:workers";
import { redirect } from "react-router";
import { randomToken, sha256 } from "./crypto.server";

const COOKIE_NAME = "itms_session";

export type SessionUser = {
  sessionId: string;
  userId: string;
  organizationId: string;
  organizationName: string;
  email: string;
  displayName: string;
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

export async function createSession(userId: string, organizationId: string): Promise<string> {
  const token = randomToken();
  const tokenHash = await sha256(token);
  const now = new Date();
  const ttl = Math.max(900, Number(env.SESSION_TTL_SECONDS || 28_800));
  const expiresAt = new Date(now.getTime() + ttl * 1000);
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, organization_id, token_hash, expires_at, last_seen_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), userId, organizationId, tokenHash, expiresAt.toISOString(), now.toISOString(), now.toISOString())
    .run();
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ttl}`;
}

export async function getSessionUser(request: Request): Promise<SessionUser | null> {
  const token = cookieValue(request, COOKIE_NAME);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(
    `SELECT s.id AS session_id, u.id AS user_id, u.email, u.display_name,
            o.id AS organization_id, o.name AS organization_name
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       JOIN organizations o ON o.id = s.organization_id
       JOIN memberships m ON m.user_id = u.id AND m.organization_id = o.id
      WHERE s.token_hash = ? AND s.expires_at > ?
        AND u.status = 'active' AND o.status = 'active' AND m.status = 'active'`,
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
    permissions: permissionRows.results.map((item) => item.code),
  };
}

export async function requireSessionUser(request: Request, permission?: string): Promise<SessionUser> {
  const user = await getSessionUser(request);
  if (!user) throw redirect("/login");
  if (permission && !user.permissions.includes(permission)) throw new Response("没有权限执行此操作", { status: 403 });
  return user;
}

export async function destroySession(request: Request): Promise<string> {
  const token = cookieValue(request, COOKIE_NAME);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
