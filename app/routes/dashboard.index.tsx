import { env } from "cloudflare:workers";
import type { Route } from "./+types/dashboard.index";
import { requireSessionUser } from "../lib/auth.server";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireSessionUser(request, "dashboard.view");
  const [customers, leads, opportunities, portalAccounts] = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS count FROM customers WHERE organization_id = ? AND status = 'active'").bind(user.organizationId),
    env.DB.prepare("SELECT COUNT(*) AS count FROM sales_leads WHERE organization_id = ? AND status NOT IN ('converted', 'lost')").bind(user.organizationId),
    env.DB.prepare("SELECT COUNT(*) AS count FROM sales_opportunities WHERE organization_id = ? AND stage NOT IN ('won', 'lost')").bind(user.organizationId),
    env.DB.prepare("SELECT COUNT(*) AS count FROM customer_portal_accounts WHERE organization_id = ? AND status = 'active'").bind(user.organizationId),
  ]);
  const count = (result: D1Result) => Number((result.results[0] as { count?: number } | undefined)?.count ?? 0);
  return { user, stats: { customers: count(customers), leads: count(leads), opportunities: count(opportunities), portalAccounts: count(portalAccounts) } };
}

export function meta() { return [{ title: "工作台 | International TMS" }]; }

export default function DashboardIndex({ loaderData }: Route.ComponentProps) {
  return <><header className="page-header"><div><p className="eyebrow">OPERATIONS CENTER</p><h1>你好，{loaderData.user.displayName}</h1><p>欧凌国际物流 · 国际零担运营后台</p></div><span className="status-pill">后台服务正常</span></header>
    <section className="stats stats-four"><article><span>有效客户</span><strong>{loaderData.stats.customers}</strong><small>客户主数据</small></article><article><span>开放线索</span><strong>{loaderData.stats.leads}</strong><small>待销售推进</small></article><article><span>开放商机</span><strong>{loaderData.stats.opportunities}</strong><small>销售漏斗</small></article><article><span>门户账号</span><strong>{loaderData.stats.portalAccounts}</strong><small>客户协作</small></article></section>
    <section className="panel"><h2>已交付基础能力</h2><div className="module-list"><div><span className="module-icon done">✓</span><div><strong>后台操作与客户门户</strong><p>独立入口、独立会话和客户级授权。</p></div><span>已启用</span></div><div><span className="module-icon done">✓</span><div><strong>基础数据与客户 360</strong><p>标准代码、客户、联系人、地址和信用资料。</p></div><span>已启用</span></div><div><span className="module-icon done">✓</span><div><strong>销售漏斗与安全中心</strong><p>线索、商机、活动、权限和风险会话控制。</p></div><span>已启用</span></div></div></section>
  </>;
}
