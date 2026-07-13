import { env } from "cloudflare:workers";
import { Form, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/login";
import { createSession, getSessionUser } from "../lib/auth.server";
import { verifyPassword } from "../lib/crypto.server";
import { valueOf } from "../lib/validation";
import { writeAudit } from "../lib/audit.server";

export function meta() { return [{ title: "登录 | International TMS" }]; }

export async function loader({ request }: Route.LoaderArgs) {
  if (await getSessionUser(request)) throw redirect("/dashboard");
  return null;
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const email = valueOf(form, "email").toLowerCase();
  const password = valueOf(form, "password");
  const user = await env.DB.prepare(
    `SELECT u.id, u.password_hash, m.organization_id
       FROM users u JOIN memberships m ON m.user_id = u.id
      WHERE u.email = ? AND u.status = 'active' AND m.status = 'active' LIMIT 1`,
  ).bind(email).first<{ id: string; password_hash: string; organization_id: string }>();
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    await writeAudit({ request, action: "auth.login", resourceType: "session", outcome: "failure", metadata: { email } });
    return { error: "邮箱或密码不正确", email };
  }
  await env.DB.prepare("UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?").bind(new Date().toISOString(), new Date().toISOString(), user.id).run();
  await writeAudit({ request, action: "auth.login", resourceType: "session", organizationId: user.organization_id, actorUserId: user.id });
  return redirect("/dashboard", { headers: { "Set-Cookie": await createSession(user.id, user.organization_id) } });
}

export default function Login({ actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  return <main className="auth-page"><section className="auth-card">
    <div className="brand-mark">IT</div><p className="eyebrow">INTERNATIONAL TMS</p><h1>欢迎回来</h1><p className="muted">登录运输管理工作台</p>
    {actionData?.error && <div className="alert error">{actionData.error}</div>}
    <Form method="post" className="stack"><label className="field"><span>邮箱</span><input name="email" type="email" defaultValue={actionData?.email} required autoComplete="email" /></label><label className="field"><span>密码</span><input name="password" type="password" required autoComplete="current-password" /></label><button className="primary" disabled={busy}>{busy ? "正在登录…" : "登录"}</button></Form>
  </section></main>;
}
