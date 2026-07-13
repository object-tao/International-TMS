import { env } from "cloudflare:workers";
import type { Route } from "./+types/dashboard.index";
import { requireSessionUser } from "../lib/auth.server";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireSessionUser(request, "dashboard.view");
  const [members, roles, audit] = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS count FROM memberships WHERE organization_id = ? AND status = 'active'").bind(user.organizationId),
    env.DB.prepare("SELECT COUNT(*) AS count FROM roles WHERE organization_id = ?").bind(user.organizationId),
    env.DB.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE organization_id = ? AND created_at >= datetime('now', '-7 days')").bind(user.organizationId),
  ]);
  const count = (result: D1Result) => Number((result.results[0] as { count?: number } | undefined)?.count ?? 0);
  return { user, stats: { members: count(members), roles: count(roles), audit: count(audit) } };
}

export function meta() { return [{ title: "工作台 | International TMS" }]; }

export default function DashboardIndex({ loaderData }: Route.ComponentProps) {
  return <><header className="page-header"><div><p className="eyebrow">IDENTITY & ACCESS</p><h1>你好，{loaderData.user.displayName}</h1><p>第一阶段 · 系统基础与权限模块</p></div><span className="status-pill">基础服务正常</span></header>
    <section className="stats"><article><span>有效用户</span><strong>{loaderData.stats.members}</strong><small>当前组织</small></article><article><span>角色</span><strong>{loaderData.stats.roles}</strong><small>权限集合</small></article><article><span>近 7 天审计事件</span><strong>{loaderData.stats.audit}</strong><small>安全留痕</small></article></section>
    <section className="panel"><h2>模块状态</h2><div className="module-list"><div><span className="module-icon done">✓</span><div><strong>组织与租户隔离</strong><p>所有业务数据从组织维度隔离。</p></div><span>已启用</span></div><div><span className="module-icon done">✓</span><div><strong>用户与会话安全</strong><p>安全密码散列、HttpOnly 会话和状态控制。</p></div><span>已启用</span></div><div><span className="module-icon done">✓</span><div><strong>角色权限与审计</strong><p>细粒度权限和关键操作留痕。</p></div><span>已启用</span></div></div></section>
  </>;
}
