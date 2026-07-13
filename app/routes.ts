import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("setup", "routes/setup.tsx"),
  route("login", "routes/login.tsx"),
  route("portal/login", "routes/portal.login.tsx"),
  route("logout", "routes/logout.tsx"),
  layout("routes/dashboard.tsx", [
    route("admin", "routes/dashboard.index.tsx"),
    route("admin/master-data", "routes/admin.master-data.tsx"),
    route("admin/customers", "routes/admin.customers.tsx"),
    route("admin/sales", "routes/admin.sales.tsx"),
    route("admin/users", "routes/dashboard.users.tsx"),
    route("admin/roles", "routes/dashboard.roles.tsx"),
    route("admin/security", "routes/admin.security.tsx"),
    route("admin/audit", "routes/dashboard.audit.tsx"),
  ]),
  layout("routes/portal.tsx", [
    route("portal", "routes/portal.index.tsx"),
  ]),
  route("dashboard", "routes/legacy.admin.tsx"),
] satisfies RouteConfig;
