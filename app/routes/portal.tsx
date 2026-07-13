import { Form, NavLink, Outlet } from "react-router";
import type { Route } from "./+types/portal";
import { requireSessionUser } from "../lib/auth.server";

export async function loader({ request }: Route.LoaderArgs) {
  return { user: await requireSessionUser(request, undefined, "portal") };
}

export default function PortalLayout({ loaderData }: Route.ComponentProps) {
  const { user } = loaderData;
  return <div className="portal-shell">
    <header className="portal-topbar"><div className="brand portal-brand"><span className="brand-mark small portal-mark">OT</span><div><strong>欧凌客户门户</strong><small>{user.organizationName}</small></div></div><nav><NavLink to="/portal" end>门户首页</NavLink></nav><div className="portal-user"><span>{user.displayName}</span><Form action="/logout" method="post"><button className="text-button">退出</button></Form></div></header>
    <main className="portal-content"><Outlet /></main>
  </div>;
}
