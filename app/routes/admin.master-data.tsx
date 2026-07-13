import { env } from "cloudflare:workers";
import { Form, Link, useNavigation } from "react-router";
import type { Route } from "./+types/admin.master-data";
import { requireSessionUser } from "../lib/auth.server";
import { validateCode, valueOf } from "../lib/validation";
import { writeAudit } from "../lib/audit.server";

const categories = [
  ["country", "国家/地区"], ["currency", "币种"], ["unit", "计量单位"], ["transport_mode", "运输方式"],
  ["service_level", "服务等级"], ["cargo_type", "货物类型"], ["lead_source", "线索来源"],
] as const;
type Category = typeof categories[number][0];
type ReferenceRow = { id: string; category: string; code: string; name: string; name_en: string | null; sort_order: number; status: string };

function selectedCategory(request: Request): Category {
  const value = new URL(request.url).searchParams.get("category");
  return categories.some(([code]) => code === value) ? value as Category : "country";
}

export async function loader({ request }: Route.LoaderArgs) {
  const current = await requireSessionUser(request, "master.view");
  const category = selectedCategory(request);
  const rows = await env.DB.prepare("SELECT id, category, code, name, name_en, sort_order, status FROM reference_data WHERE organization_id = ? AND category = ? ORDER BY sort_order, code").bind(current.organizationId, category).all<ReferenceRow>();
  return { current, category, rows: rows.results };
}

export async function action({ request }: Route.ActionArgs) {
  const current = await requireSessionUser(request, "master.manage");
  const form = await request.formData();
  const intent = valueOf(form, "intent");
  if (intent === "toggle") {
    const id = valueOf(form, "id");
    const row = await env.DB.prepare("SELECT status FROM reference_data WHERE id = ? AND organization_id = ?").bind(id, current.organizationId).first<{ status: string }>();
    if (!row) return { formError: "基础数据不存在" };
    const status = row.status === "active" ? "disabled" : "active";
    await env.DB.prepare("UPDATE reference_data SET status = ?, updated_at = ? WHERE id = ? AND organization_id = ?").bind(status, new Date().toISOString(), id, current.organizationId).run();
    await writeAudit({ request, action: "master.toggle", resourceType: "reference_data", resourceId: id, organizationId: current.organizationId, actorUserId: current.userId, metadata: { status } });
    return { success: "状态已更新" };
  }
  const category = valueOf(form, "category") as Category;
  const code = valueOf(form, "code").toUpperCase();
  const name = valueOf(form, "name");
  const nameEn = valueOf(form, "nameEn");
  const sortOrder = Number(valueOf(form, "sortOrder") || 0);
  const errors: Record<string, string> = {};
  if (!categories.some(([item]) => item === category)) errors.category = "分类无效";
  const codeError = validateCode(code.toLowerCase()); if (codeError) errors.code = codeError;
  if (name.length < 1 || name.length > 80) errors.name = "名称需要 1-80 个字符";
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999) errors.sortOrder = "排序需要是 0-9999 的整数";
  if (Object.keys(errors).length) return { errors, values: { category, code, name, nameEn, sortOrder } };
  const now = new Date().toISOString(), id = crypto.randomUUID();
  try {
    await env.DB.prepare("INSERT INTO reference_data (id, organization_id, category, code, name, name_en, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, current.organizationId, category, code, name, nameEn || null, sortOrder, now, now).run();
  } catch {
    return { formError: "同一分类下代码不能重复", values: { category, code, name, nameEn, sortOrder } };
  }
  await writeAudit({ request, action: "master.create", resourceType: "reference_data", resourceId: id, organizationId: current.organizationId, actorUserId: current.userId, metadata: { category, code } });
  return { success: "基础数据已创建" };
}

export function meta() { return [{ title: "基础数据 | International TMS" }]; }

export default function MasterData({ loaderData, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  return <><header className="page-header"><div><p className="eyebrow">MASTER DATA</p><h1>基础数据</h1><p>维护运输、计费和销售流程共用的标准代码。</p></div><span className="status-pill">{loaderData.rows.length} 项</span></header>
    <nav className="tabs">{categories.map(([code, label]) => <Link key={code} className={loaderData.category === code ? "active" : ""} to={`?category=${code}`}>{label}</Link>)}</nav>
    {(actionData?.success || actionData?.formError) && <div className={`alert ${actionData.formError ? "error" : "success"}`}>{actionData.formError ?? actionData.success}</div>}
    {loaderData.current.permissions.includes("master.manage") && <section className="panel"><h2>新增基础数据</h2><Form method="post" className="form-grid compact"><input type="hidden" name="intent" value="create"/><input type="hidden" name="category" value={loaderData.category}/><label className="field"><span>代码</span><input name="code" required placeholder="CODE" defaultValue={actionData?.values?.code}/>{actionData?.errors?.code && <small className="field-error">{actionData.errors.code}</small>}</label><label className="field"><span>中文名称</span><input name="name" required defaultValue={actionData?.values?.name}/>{actionData?.errors?.name && <small className="field-error">{actionData.errors.name}</small>}</label><label className="field"><span>英文名称</span><input name="nameEn" defaultValue={actionData?.values?.nameEn}/></label><label className="field"><span>排序</span><input name="sortOrder" type="number" min="0" max="9999" defaultValue={actionData?.values?.sortOrder ?? 0}/>{actionData?.errors?.sortOrder && <small className="field-error">{actionData.errors.sortOrder}</small>}</label><button className="primary" disabled={busy}>新增</button></Form></section>}
    <section className="panel"><div className="table-wrap"><table><thead><tr><th>代码</th><th>名称</th><th>英文名称</th><th>排序</th><th>状态</th><th></th></tr></thead><tbody>{loaderData.rows.map(row => <tr key={row.id}><td><strong>{row.code}</strong></td><td>{row.name}</td><td>{row.name_en || "—"}</td><td>{row.sort_order}</td><td><span className={`status-pill ${row.status !== "active" ? "off" : ""}`}>{row.status === "active" ? "启用" : "停用"}</span></td><td>{loaderData.current.permissions.includes("master.manage") && <Form method="post"><input type="hidden" name="intent" value="toggle"/><input type="hidden" name="id" value={row.id}/><button className="text-button">{row.status === "active" ? "停用" : "启用"}</button></Form>}</td></tr>)}</tbody></table></div></section>
  </>;
}
