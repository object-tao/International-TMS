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
        <NavLink to="/dashboard" end>工作台</NavLink>
        {can("user.view") && <NavLink to="/users">用户管理</NavLink>}
        {can("role.view") && <NavLink to="/roles">角色权限</NavLink>}
        {can("audit.view") && <NavLink to="/audit">审计日志</NavLink>}
      </nav>
      <div className="sidebar-user"><span>{user.displayName}</span><small>{user.email}</small><Form action="/logout" method="post"><button className="text-button">退出登录</button></Form></div>
    </aside>
    <main className="content"><Outlet /></main>
  </div>;
}
