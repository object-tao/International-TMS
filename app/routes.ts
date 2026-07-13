import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("setup", "routes/setup.tsx"),
  route("login", "routes/login.tsx"),
  route("logout", "routes/logout.tsx"),
  layout("routes/dashboard.tsx", [
    route("dashboard", "routes/dashboard.index.tsx"),
    route("users", "routes/dashboard.users.tsx"),
    route("roles", "routes/dashboard.roles.tsx"),
    route("audit", "routes/dashboard.audit.tsx"),
  ]),
] satisfies RouteConfig;
