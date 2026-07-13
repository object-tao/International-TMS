import { env } from "cloudflare:workers";
import { Form, useNavigation } from "react-router";
import type { Route } from "./+types/admin.quotations";
import { requireSessionUser } from "../lib/auth.server";
import { nextDocumentNumber } from "../lib/documents.server";
import { canTransition, nextStates } from "../lib/workflow";
import { valueOf } from "../lib/validation";
import { writeAudit } from "../lib/audit.server";

type Quote = { id: string; quote_number: string; customer_name: string; origin_country: string; origin_city: string; destination_country: string; destination_city: string; transport_mode: string; service_level: string | null; cargo_description: string; pieces: number; gross_weight_kg: number; volume_cbm: number; currency: string; total_amount: number; valid_until: string | null; status: string; created_at: string; charges: string | null };

export async function loader({ request }: Route.LoaderArgs) {
  const current = await requireSessionUser(request, "quote.view");
  const [quotes, customers, opportunities, modes, services, currencies, countries] = await Promise.all([
    env.DB.prepare(`SELECT q.id, q.quote_number, c.name AS customer_name, q.origin_country, q.origin_city, q.destination_country, q.destination_city, q.transport_mode, q.service_level, q.cargo_description, q.pieces, q.gross_weight_kg, q.volume_cbm, q.currency, q.total_amount, q.valid_until, q.status, q.created_at, GROUP_CONCAT(qc.description || ': ' || qc.amount, '；') AS charges FROM quotations q JOIN customers c ON c.id = q.customer_id LEFT JOIN quotation_charges qc ON qc.quotation_id = q.id WHERE q.organization_id = ? GROUP BY q.id ORDER BY q.created_at DESC LIMIT 200`).bind(current.organizationId).all<Quote>(),
    env.DB.prepare("SELECT id, code, name FROM customers WHERE organization_id = ? AND status = 'active' ORDER BY name").bind(current.organizationId).all<{ id: string; code: string; name: string }>(),
    env.DB.prepare("SELECT id, name FROM sales_opportunities WHERE organization_id = ? AND stage NOT IN ('won','lost') ORDER BY updated_at DESC").bind(current.organizationId).all<{ id: string; name: string }>(),
    reference(current.organizationId, "transport_mode"), reference(current.organizationId, "service_level"), reference(current.organizationId, "currency"), reference(current.organizationId, "country"),
  ]);
  return { current, quotes: quotes.results, customers: customers.results, opportunities: opportunities.results, modes: modes.results, services: services.results, currencies: currencies.results, countries: countries.results };
}

export async function action({ request }: Route.ActionArgs) {
  const current = await requireSessionUser(request, "quote.manage");
  const form = await request.formData(), intent = valueOf(form, "intent"), now = new Date().toISOString();
  if (intent === "status") {
    const id = valueOf(form, "id"), status = valueOf(form, "status");
    const quote = await env.DB.prepare("SELECT status FROM quotations WHERE id = ? AND organization_id = ?").bind(id, current.organizationId).first<{ status: string }>();
    if (!quote || !canTransition("quote", quote.status, status)) return { formError: "报价状态流转无效" };
    await env.DB.prepare("UPDATE quotations SET status = ?, accepted_at = CASE WHEN ? = 'accepted' THEN ? ELSE accepted_at END, updated_at = ? WHERE id = ? AND organization_id = ?").bind(status, status, now, now, id, current.organizationId).run();
    await writeAudit({ request, action: "quote.status", resourceType: "quotation", resourceId: id, organizationId: current.organizationId, actorUserId: current.userId, metadata: { from: quote.status, to: status } });
    return { success: "报价状态已更新" };
  }
  const customerId = valueOf(form, "customerId"), opportunityId = valueOf(form, "opportunityId"), originCountry = valueOf(form, "originCountry"), originCity = valueOf(form, "originCity"), destinationCountry = valueOf(form, "destinationCountry"), destinationCity = valueOf(form, "destinationCity"), mode = valueOf(form, "mode"), service = valueOf(form, "service"), cargo = valueOf(form, "cargo"), currency = valueOf(form, "currency") || "USD", validUntil = valueOf(form, "validUntil"), notes = valueOf(form, "notes");
  const pieces = Number(valueOf(form, "pieces") || 1), weight = Number(valueOf(form, "weight") || 0), volume = Number(valueOf(form, "volume") || 0), freight = Number(valueOf(form, "freight") || 0), surcharge = Number(valueOf(form, "surcharge") || 0), taxRate = Number(valueOf(form, "taxRate") || 0);
  if (!(await env.DB.prepare("SELECT 1 FROM customers WHERE id = ? AND organization_id = ? AND status = 'active'").bind(customerId, current.organizationId).first())) return { formError: "请选择有效客户" };
  if (opportunityId && !(await env.DB.prepare("SELECT 1 FROM sales_opportunities WHERE id = ? AND organization_id = ?").bind(opportunityId, current.organizationId).first())) return { formError: "关联商机无效" };
  if (!originCity || !destinationCity || !cargo || !mode || !Number.isInteger(pieces) || pieces < 1 || [weight, volume, freight, surcharge, taxRate].some(value => !Number.isFinite(value) || value < 0)) return { formError: "请填写完整路线、货物和有效费用" };
  const subtotal = freight + surcharge, tax = Number((subtotal * taxRate / 100).toFixed(2)), total = subtotal + tax, id = crypto.randomUUID(), number = await nextDocumentNumber(current.organizationId, "quote");
  const statements = [
    env.DB.prepare(`INSERT INTO quotations (id, organization_id, quote_number, customer_id, opportunity_id, origin_country, origin_city, destination_country, destination_city, transport_mode, service_level, cargo_description, pieces, gross_weight_kg, volume_cbm, currency, subtotal, tax_amount, total_amount, valid_until, notes, created_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, current.organizationId, number, customerId, opportunityId || null, originCountry, originCity, destinationCountry, destinationCity, mode, service || null, cargo, pieces, weight, volume, currency, subtotal, tax, total, validUntil || null, notes || null, current.userId, now, now),
    env.DB.prepare("INSERT INTO quotation_charges (id, quotation_id, charge_code, description, quantity, unit_price, amount, sort_order, created_at) VALUES (?, ?, 'FREIGHT', '基础运费', 1, ?, ?, 10, ?)").bind(crypto.randomUUID(), id, freight, freight, now),
  ];
  if (surcharge > 0) statements.push(env.DB.prepare("INSERT INTO quotation_charges (id, quotation_id, charge_code, description, quantity, unit_price, amount, sort_order, created_at) VALUES (?, ?, 'SURCHARGE', '附加费', 1, ?, ?, 20, ?)").bind(crypto.randomUUID(), id, surcharge, surcharge, now));
  await env.DB.batch(statements);
  await writeAudit({ request, action: "quote.create", resourceType: "quotation", resourceId: id, organizationId: current.organizationId, actorUserId: current.userId, metadata: { number, total } });
  return { success: `报价 ${number} 已创建` };
}

function reference(organizationId: string, category: string) { return env.DB.prepare("SELECT code, name FROM reference_data WHERE organization_id = ? AND category = ? AND status = 'active' ORDER BY sort_order, code").bind(organizationId, category).all<{ code: string; name: string }>(); }
export function meta() { return [{ title: "询价报价 | International TMS" }]; }
const statusLabels: Record<string, string> = { draft: "草稿", sent: "已发送", accepted: "已接受", rejected: "已拒绝", expired: "已过期", cancelled: "已取消" };

export default function Quotations({ loaderData, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle", manage = loaderData.current.permissions.includes("quote.manage");
  return <><header className="page-header"><div><p className="eyebrow">QUOTATION</p><h1>询价与报价</h1><p>按客户、路线、货量和服务生成标准运输报价。</p></div><span className="status-pill">{loaderData.quotes.length} 份报价</span></header>
    {(actionData?.success || actionData?.formError) && <div className={`alert ${actionData.formError ? "error" : "success"}`}>{actionData.formError ?? actionData.success}</div>}
    {manage && <details className="panel expandable" open={loaderData.quotes.length === 0}><summary>创建报价</summary><Form method="post" className="form-grid"><input type="hidden" name="intent" value="create"/><Select label="客户" name="customerId" items={loaderData.customers.map(item => [item.id, `${item.code} · ${item.name}`])}/><Select label="关联商机" name="opportunityId" optional items={loaderData.opportunities.map(item => [item.id, item.name])}/><Select label="起运国家" name="originCountry" items={loaderData.countries.map(item => [item.code, `${item.code} · ${item.name}`])}/><label className="field"><span>起运城市</span><input name="originCity" required/></label><Select label="目的国家" name="destinationCountry" items={loaderData.countries.map(item => [item.code, `${item.code} · ${item.name}`])}/><label className="field"><span>目的城市</span><input name="destinationCity" required/></label><Select label="运输方式" name="mode" items={loaderData.modes.map(item => [item.code, item.name])}/><Select label="服务等级" name="service" optional items={loaderData.services.map(item => [item.code, item.name])}/><label className="field span-2"><span>货物描述</span><input name="cargo" required/></label><Num label="件数" name="pieces" value="1"/><Num label="毛重（KG）" name="weight"/><Num label="体积（CBM）" name="volume" step="0.001"/><Select label="币种" name="currency" items={loaderData.currencies.map(item => [item.code, item.code])}/><Num label="基础运费" name="freight" step="0.01"/><Num label="附加费" name="surcharge" step="0.01"/><Num label="税率（%）" name="taxRate" step="0.01"/><label className="field"><span>有效期至</span><input name="validUntil" type="date"/></label><label className="field span-2"><span>备注</span><input name="notes"/></label><button className="primary" disabled={busy}>生成报价</button></Form></details>}
    <section className="panel"><div className="table-wrap"><table><thead><tr><th>报价号/客户</th><th>路线</th><th>货物</th><th>费用</th><th>有效期</th><th>状态</th></tr></thead><tbody>{loaderData.quotes.map(q => <tr key={q.id}><td><strong>{q.quote_number}</strong><small>{q.customer_name}</small></td><td><strong>{q.origin_country} {q.origin_city} → {q.destination_country} {q.destination_city}</strong><small>{q.transport_mode} · {q.service_level || "标准"}</small></td><td><strong>{q.cargo_description}</strong><small>{q.pieces} 件 · {q.gross_weight_kg} KG · {q.volume_cbm} CBM</small></td><td><strong>{q.currency} {q.total_amount.toLocaleString()}</strong><small>{q.charges || "—"}</small></td><td>{q.valid_until || "—"}</td><td>{manage && nextStates("quote", q.status).length ? <Form method="post" className="inline-form"><input type="hidden" name="intent" value="status"/><input type="hidden" name="id" value={q.id}/><select name="status" defaultValue=""><option value="" disabled>{statusLabels[q.status]}</option>{nextStates("quote", q.status).map(status => <option key={status} value={status}>{statusLabels[status]}</option>)}</select><button className="text-button">更新</button></Form> : <span className="status-pill">{statusLabels[q.status]}</span>}</td></tr>)}</tbody></table></div></section>
  </>;
}

function Select({ label, name, items, optional }: { label: string; name: string; items: [string, string][]; optional?: boolean }) { return <label className="field"><span>{label}</span><select name={name} required={!optional}><option value="">{optional ? "未指定" : "请选择"}</option>{items.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>; }
function Num({ label, name, value = "0", step = "1" }: { label: string; name: string; value?: string; step?: string }) { return <label className="field"><span>{label}</span><input name={name} type="number" min="0" step={step} defaultValue={value} required/></label>; }
