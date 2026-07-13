import { env } from "cloudflare:workers";
import type { Route } from "./+types/dashboard.audit";
import { requireSessionUser } from "../lib/auth.server";

type AuditRow = { id: string; action: string; resource_type: string; outcome: string; display_name: string | null; ip_address: string | null; created_at: string };

export async function loader({ request }: Route.LoaderArgs) {
  const current = await requireSessionUser(request, "audit.view");
  const logs = await env.DB.prepare(`SELECT a.id, a.action, a.resource_type, a.outcome, a.ip_address, a.created_at, u.display_name FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id WHERE a.organization_id = ? ORDER BY a.created_at DESC LIMIT 100`).bind(current.organizationId).all<AuditRow>();
  return { logs: logs.results };
}

export function meta() { return [{ title: "审计日志 | International TMS" }]; }

const labels: Record<string, string> = { "system.bootstrap": "初始化系统", "auth.login": "用户登录", "auth.logout": "退出登录", "user.create": "创建用户", "membership.active": "恢复用户", "membership.disabled": "停用用户", "role.create": "创建角色" };

export default function Audit({ loaderData }: Route.ComponentProps) {
  return <><header className="page-header"><div><p className="eyebrow">AUDIT TRAIL</p><h1>审计日志</h1><p>展示当前组织最近 100 条关键安全操作。</p></div></header><section className="panel"><div className="table-wrap"><table><thead><tr><th>时间</th><th>操作人</th><th>事件</th><th>对象</th><th>来源 IP</th><th>结果</th></tr></thead><tbody>{loaderData.logs.map(log => <tr key={log.id}><td>{new Date(log.created_at).toLocaleString("zh-CN")}</td><td>{log.display_name || "系统/未知"}</td><td>{labels[log.action] || log.action}</td><td>{log.resource_type}</td><td>{log.ip_address || "—"}</td><td><span className={`status-pill ${log.outcome !== "success" ? "off" : ""}`}>{log.outcome === "success" ? "成功" : "失败"}</span></td></tr>)}</tbody></table></div></section></>;
}
