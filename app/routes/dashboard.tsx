import { Form, NavLink, Outlet } from "react-router";
import type { Route } from "./+types/dashboard";
import { requireSessionUser } from "../lib/auth.server";

export async function loader({ request }: Route.LoaderArgs) {
  return { user: await requireSessionUser(request) };
}

export default function DashboardLayout({ loaderData }: Route.ComponentProps) {
  const { user } = loaderData;
  const can = (permission: string) => user.permissions.includes(permission);
  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark small">IT</span><div><strong>International TMS</strong><small>{user.organizationName}</small></div></div>
      <nav>
        <NavLink to="/admin" end>运营总览</NavLink>
        {can("master.view") && <NavLink to="/admin/master-data">基础数据</NavLink>}
        {can("customer.view") && <NavLink to="/admin/customers">客户管理</NavLink>}
        {can("sales.view") && <NavLink to="/admin/sales">销售管理</NavLink>}
        {can("quote.view") && <NavLink to="/admin/quotations">询价报价</NavLink>}
        {can("order.view") && <NavLink to="/admin/orders">运输订单</NavLink>}
        {can("shipment.view") && <NavLink to="/admin/shipments">运单轨迹</NavLink>}
        {can("billing.view") && <NavLink to="/admin/billing">应收账单</NavLink>}
        {can("user.view") && <NavLink to="/admin/users">用户管理</NavLink>}
        {can("role.view") && <NavLink to="/admin/roles">角色权限</NavLink>}
        {can("security.manage") && <NavLink to="/admin/security">安全中心</NavLink>}
        {can("audit.view") && <NavLink to="/admin/audit">审计日志</NavLink>}
      </nav>
      <div className="sidebar-user"><span>{user.displayName}</span><small>{user.email}</small><Form action="/logout" method="post"><button className="text-button">退出登录</button></Form></div>
    </aside>
    <main className="content"><Outlet /></main>
  </div>;
}
