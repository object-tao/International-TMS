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
    route("admin/quotations", "routes/admin.quotations.tsx"),
    route("admin/orders", "routes/admin.orders.tsx"),
    route("admin/shipments", "routes/admin.shipments.tsx"),
    route("admin/billing", "routes/admin.billing.tsx"),
    route("admin/users", "routes/dashboard.users.tsx"),
    route("admin/roles", "routes/dashboard.roles.tsx"),
    route("admin/security", "routes/admin.security.tsx"),
    route("admin/audit", "routes/dashboard.audit.tsx"),
  ]),
  layout("routes/portal.tsx", [
    route("portal", "routes/portal.index.tsx"),
    route("portal/orders", "routes/portal.orders.tsx"),
    route("portal/tracking", "routes/portal.tracking.tsx"),
    route("portal/billing", "routes/portal.billing.tsx"),
  ]),
  route("dashboard", "routes/legacy.admin.tsx"),
] satisfies RouteConfig;
