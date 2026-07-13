import { env } from "cloudflare:workers";
import { Form, useNavigation } from "react-router";
import type { Route } from "./+types/admin.customers";
import { requireSessionUser } from "../lib/auth.server";
import { hashPassword } from "../lib/crypto.server";
import { validateCode, validateEmail, validatePassword, valueOf } from "../lib/validation";
import { writeAudit } from "../lib/audit.server";

type CustomerRow = { id: string; code: string; name: string; short_name: string | null; type: string; status: string; sales_owner_name: string | null; credit_limit: number; credit_currency: string; payment_terms_days: number; contact_count: number; address_count: number };
type ContactRow = { id: string; customer_id: string; name: string; title: string | null; email: string | null; phone: string | null; is_primary: number };
type AddressRow = { id: string; customer_id: string; label: string; type: string; country_code: string; city: string; address_line1: string; is_default: number };
type PortalRow = { id: string; customer_id: string; display_name: string; email: string; status: string; last_login_at: string | null };

export async function loader({ request }: Route.LoaderArgs) {
  const current = await requireSessionUser(request, "customer.view");
  const [customers, contacts, addresses, portals, owners, currencies, countries] = await Promise.all([
    env.DB.prepare(`SELECT c.id, c.code, c.name, c.short_name, c.type, c.status, u.display_name AS sales_owner_name, c.credit_limit, c.credit_currency, c.payment_terms_days, COUNT(DISTINCT cc.id) AS contact_count, COUNT(DISTINCT ca.id) AS address_count FROM customers c LEFT JOIN users u ON u.id = c.sales_owner_user_id LEFT JOIN customer_contacts cc ON cc.customer_id = c.id LEFT JOIN customer_addresses ca ON ca.customer_id = c.id WHERE c.organization_id = ? GROUP BY c.id ORDER BY c.created_at DESC LIMIT 200`).bind(current.organizationId).all<CustomerRow>(),
    env.DB.prepare(`SELECT cc.id, cc.customer_id, cc.name, cc.title, cc.email, cc.phone, cc.is_primary FROM customer_contacts cc JOIN customers c ON c.id = cc.customer_id WHERE c.organization_id = ? ORDER BY cc.is_primary DESC, cc.name`).bind(current.organizationId).all<ContactRow>(),
    env.DB.prepare(`SELECT ca.id, ca.customer_id, ca.label, ca.type, ca.country_code, ca.city, ca.address_line1, ca.is_default FROM customer_addresses ca JOIN customers c ON c.id = ca.customer_id WHERE c.organization_id = ? ORDER BY ca.is_default DESC, ca.label`).bind(current.organizationId).all<AddressRow>(),
    env.DB.prepare(`SELECT cpa.id, cpa.customer_id, u.display_name, u.email, cpa.status, u.last_login_at FROM customer_portal_accounts cpa JOIN users u ON u.id = cpa.user_id WHERE cpa.organization_id = ? ORDER BY u.display_name`).bind(current.organizationId).all<PortalRow>(),
    env.DB.prepare(`SELECT u.id, u.display_name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.organization_id = ? AND m.status = 'active' ORDER BY u.display_name`).bind(current.organizationId).all<{ id: string; display_name: string }>(),
    env.DB.prepare("SELECT code, name FROM reference_data WHERE organization_id = ? AND category = 'currency' AND status = 'active' ORDER BY sort_order, code").bind(current.organizationId).all<{ code: string; name: string }>(),
    env.DB.prepare("SELECT code, name FROM reference_data WHERE organization_id = ? AND category = 'country' AND status = 'active' ORDER BY sort_order, code").bind(current.organizationId).all<{ code: string; name: string }>(),
  ]);
  return { current, customers: customers.results, contacts: contacts.results, addresses: addresses.results, portals: portals.results, owners: owners.results, currencies: currencies.results, countries: countries.results };
}

export async function action({ request }: Route.ActionArgs) {
  const current = await requireSessionUser(request, "customer.manage");
  const form = await request.formData();
  const intent = valueOf(form, "intent");
  const now = new Date().toISOString();

  if (intent === "contact") {
    const customerId = valueOf(form, "customerId"), name = valueOf(form, "name"), title = valueOf(form, "title"), email = valueOf(form, "email").toLowerCase(), phone = valueOf(form, "phone");
    if (!(await ownedCustomer(customerId, current.organizationId))) return { formError: "客户不存在" };
    if (name.length < 2) return { formError: "联系人姓名至少 2 个字符" };
    if (email && validateEmail(email)) return { formError: "联系人邮箱格式不正确" };
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO customer_contacts (id, customer_id, name, title, email, phone, is_primary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, customerId, name, title || null, email || null, phone || null, form.has("isPrimary") ? 1 : 0, now, now).run();
    await writeAudit({ request, action: "customer.contact.create", resourceType: "customer_contact", resourceId: id, organizationId: current.organizationId, actorUserId: current.userId, metadata: { customerId } });
    return { success: "联系人已添加" };
  }

  if (intent === "address") {
    const customerId = valueOf(form, "customerId"), label = valueOf(form, "label"), type = valueOf(form, "type"), countryCode = valueOf(form, "countryCode"), city = valueOf(form, "city"), addressLine1 = valueOf(form, "addressLine1");
    if (!(await ownedCustomer(customerId, current.organizationId))) return { formError: "客户不存在" };
    if (!label || !city || !addressLine1) return { formError: "地址名称、城市和详细地址必填" };
    if (!['registered', 'billing', 'shipping', 'warehouse'].includes(type)) return { formError: "地址类型无效" };
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO customer_addresses (id, customer_id, type, label, country_code, city, address_line1, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, customerId, type, label, countryCode || "CN", city, addressLine1, form.has("isDefault") ? 1 : 0, now, now).run();
    await writeAudit({ request, action: "customer.address.create", resourceType: "customer_address", resourceId: id, organizationId: current.organizationId, actorUserId: current.userId, metadata: { customerId } });
    return { success: "地址已添加" };
  }

  if (intent === "portal") {
    const customerId = valueOf(form, "customerId"), displayName = valueOf(form, "displayName"), email = valueOf(form, "email").toLowerCase(), password = valueOf(form, "password");
    if (!(await ownedCustomer(customerId, current.organizationId))) return { formError: "客户不存在" };
    const emailError = validateEmail(email), passwordError = validatePassword(password);
    if (displayName.length < 2 || emailError || passwordError) return { formError: emailError || passwordError || "门户用户姓名至少 2 个字符" };
    if (await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first()) return { formError: "该邮箱已被使用" };
    const userId = crypto.randomUUID(), accountId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").bind(userId, email, await hashPassword(password), displayName, now, now),
      env.DB.prepare("INSERT INTO customer_portal_accounts (id, organization_id, customer_id, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").bind(accountId, current.organizationId, customerId, userId, now, now),
    ]);
    await writeAudit({ request, action: "portal.account.create", resourceType: "customer_portal_account", resourceId: accountId, organizationId: current.organizationId, actorUserId: current.userId, metadata: { customerId, email } });
    return { success: "客户门户账号已开通" };
  }

  const code = valueOf(form, "code").toLowerCase(), name = valueOf(form, "name"), shortName = valueOf(form, "shortName"), type = valueOf(form, "type"), ownerId = valueOf(form, "ownerId"), currency = valueOf(form, "currency") || "USD";
  const creditLimit = Number(valueOf(form, "creditLimit") || 0), paymentTermsDays = Number(valueOf(form, "paymentTermsDays") || 0), notes = valueOf(form, "notes");
  const errors: Record<string, string> = {};
  const codeError = validateCode(code); if (codeError) errors.code = codeError;
  if (name.length < 2 || name.length > 120) errors.name = "客户名称需要 2-120 个字符";
  if (!['direct', 'agent', 'partner'].includes(type)) errors.type = "客户类型无效";
  if (!Number.isFinite(creditLimit) || creditLimit < 0) errors.creditLimit = "信用额度不能小于 0";
  if (!Number.isInteger(paymentTermsDays) || paymentTermsDays < 0 || paymentTermsDays > 365) errors.paymentTermsDays = "账期需要是 0-365 天";
  if (ownerId && !(await env.DB.prepare("SELECT 1 FROM memberships WHERE user_id = ? AND organization_id = ? AND status = 'active'").bind(ownerId, current.organizationId).first())) errors.ownerId = "销售负责人无效";
  if (Object.keys(errors).length) return { errors, values: { code, name, shortName, type, ownerId, currency, creditLimit, paymentTermsDays, notes } };
  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(`INSERT INTO customers (id, organization_id, code, name, short_name, type, sales_owner_user_id, credit_limit, credit_currency, payment_terms_days, status, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`).bind(id, current.organizationId, code, name, shortName || null, type, ownerId || null, creditLimit, currency, paymentTermsDays, notes || null, now, now).run();
  } catch { return { formError: "客户代码不能重复", values: { code, name, shortName, type, ownerId, currency, creditLimit, paymentTermsDays, notes } }; }
  await writeAudit({ request, action: "customer.create", resourceType: "customer", resourceId: id, organizationId: current.organizationId, actorUserId: current.userId, metadata: { code } });
  return { success: "客户已创建" };
}

async function ownedCustomer(id: string, organizationId: string) {
  return env.DB.prepare("SELECT id FROM customers WHERE id = ? AND organization_id = ?").bind(id, organizationId).first();
}

export function meta() { return [{ title: "客户管理 | International TMS" }]; }

const customerTypes: Record<string, string> = { direct: "直客", agent: "代理", partner: "合作伙伴" };

export default function Customers({ loaderData, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle", canManage = loaderData.current.permissions.includes("customer.manage");
  return <><header className="page-header"><div><p className="eyebrow">CUSTOMER 360</p><h1>客户管理</h1><p>统一维护客户、联系人、地址、信用和门户账号。</p></div><span className="status-pill">{loaderData.customers.length} 家客户</span></header>
    {(actionData?.success || actionData?.formError) && <div className={`alert ${actionData.formError ? "error" : "success"}`}>{actionData.formError ?? actionData.success}</div>}
    {canManage && <details className="panel expandable" open={loaderData.customers.length === 0}><summary>创建客户</summary><Form method="post" className="form-grid"><input type="hidden" name="intent" value="customer"/><label className="field"><span>客户代码</span><input name="code" required placeholder="ouling-client" defaultValue={actionData?.values?.code}/>{actionData?.errors?.code && <small className="field-error">{actionData.errors.code}</small>}</label><label className="field"><span>客户全称</span><input name="name" required defaultValue={actionData?.values?.name}/>{actionData?.errors?.name && <small className="field-error">{actionData.errors.name}</small>}</label><label className="field"><span>客户简称</span><input name="shortName" defaultValue={actionData?.values?.shortName}/></label><label className="field"><span>客户类型</span><select name="type" defaultValue={actionData?.values?.type || "direct"}><option value="direct">直客</option><option value="agent">代理</option><option value="partner">合作伙伴</option></select></label><label className="field"><span>销售负责人</span><select name="ownerId" defaultValue={actionData?.values?.ownerId}><option value="">未指定</option>{loaderData.owners.map(owner => <option key={owner.id} value={owner.id}>{owner.display_name}</option>)}</select></label><label className="field"><span>信用币种</span><select name="currency" defaultValue={actionData?.values?.currency || "USD"}>{loaderData.currencies.map(item => <option key={item.code} value={item.code}>{item.code} · {item.name}</option>)}</select></label><label className="field"><span>信用额度</span><input name="creditLimit" type="number" min="0" step="0.01" defaultValue={actionData?.values?.creditLimit ?? 0}/></label><label className="field"><span>账期（天）</span><input name="paymentTermsDays" type="number" min="0" max="365" defaultValue={actionData?.values?.paymentTermsDays ?? 0}/></label><label className="field span-2"><span>备注</span><input name="notes" defaultValue={actionData?.values?.notes}/></label><button className="primary" disabled={busy}>创建客户</button></Form></details>}
    <section className="cards customer-cards">{loaderData.customers.map(customer => <article className="role-card customer-card" key={customer.id}><div><div className="card-heading"><span className="status-pill">{customerTypes[customer.type]}</span><code>{customer.code}</code></div><h3>{customer.name}</h3><p>{customer.sales_owner_name ? `负责人：${customer.sales_owner_name}` : "尚未指定销售负责人"}</p><div className="customer-metrics"><span>{customer.contact_count} 联系人</span><span>{customer.address_count} 地址</span><span>{customer.credit_currency} {customer.credit_limit.toLocaleString()}</span></div></div><footer><span>账期 {customer.payment_terms_days} 天</span><span>{customer.status === "active" ? "正常" : customer.status}</span></footer></article>)}</section>
    {canManage && loaderData.customers.length > 0 && <section className="action-grid"><details className="panel expandable"><summary>添加联系人</summary><Form method="post" className="stack"><input type="hidden" name="intent" value="contact"/><CustomerSelect customers={loaderData.customers}/><label className="field"><span>姓名</span><input name="name" required/></label><label className="field"><span>职务</span><input name="title"/></label><label className="field"><span>邮箱</span><input name="email" type="email"/></label><label className="field"><span>电话</span><input name="phone"/></label><label className="check-field"><input name="isPrimary" type="checkbox"/>主要联系人</label><button className="primary" disabled={busy}>添加联系人</button></Form></details><details className="panel expandable"><summary>添加常用地址</summary><Form method="post" className="stack"><input type="hidden" name="intent" value="address"/><CustomerSelect customers={loaderData.customers}/><label className="field"><span>地址名称</span><input name="label" required placeholder="上海仓库"/></label><label className="field"><span>类型</span><select name="type"><option value="shipping">收发货</option><option value="warehouse">仓库</option><option value="billing">账单</option><option value="registered">注册地址</option></select></label><label className="field"><span>国家/地区</span><select name="countryCode">{loaderData.countries.map(item => <option key={item.code} value={item.code}>{item.code} · {item.name}</option>)}</select></label><label className="field"><span>城市</span><input name="city" required/></label><label className="field"><span>详细地址</span><input name="addressLine1" required/></label><label className="check-field"><input name="isDefault" type="checkbox"/>默认地址</label><button className="primary" disabled={busy}>添加地址</button></Form></details><details className="panel expandable"><summary>开通客户门户</summary><Form method="post" className="stack"><input type="hidden" name="intent" value="portal"/><CustomerSelect customers={loaderData.customers}/><label className="field"><span>用户姓名</span><input name="displayName" required/></label><label className="field"><span>登录邮箱</span><input name="email" type="email" required/></label><label className="field"><span>初始密码</span><input name="password" type="password" required/><small>至少 12 位，包含大小写字母和数字</small></label><button className="primary" disabled={busy}>开通门户</button></Form></details></section>}
    <section className="panel"><h2>客户档案明细</h2><div className="table-wrap"><table><thead><tr><th>客户</th><th>联系人</th><th>常用地址</th><th>门户用户</th></tr></thead><tbody>{loaderData.customers.map(customer => <tr key={customer.id}><td><strong>{customer.name}</strong><small>{customer.code}</small></td><td>{loaderData.contacts.filter(item => item.customer_id === customer.id).map(item => <div key={item.id}><strong>{item.name}{item.is_primary ? " · 主要" : ""}</strong><small>{item.email || item.phone || "—"}</small></div>)}</td><td>{loaderData.addresses.filter(item => item.customer_id === customer.id).map(item => <div key={item.id}><strong>{item.label}</strong><small>{item.country_code} {item.city} {item.address_line1}</small></div>)}</td><td>{loaderData.portals.filter(item => item.customer_id === customer.id).map(item => <div key={item.id}><strong>{item.display_name}</strong><small>{item.email}</small></div>)}</td></tr>)}</tbody></table></div></section>
  </>;
}

function CustomerSelect({ customers }: { customers: CustomerRow[] }) {
  return <label className="field"><span>客户</span><select name="customerId" required><option value="">请选择</option>{customers.map(customer => <option key={customer.id} value={customer.id}>{customer.code} · {customer.name}</option>)}</select></label>;
}
