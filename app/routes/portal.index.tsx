import { env } from "cloudflare:workers";
import type { Route } from "./+types/portal.index";
import { requireSessionUser } from "../lib/auth.server";

type CustomerSummary = { id: string; code: string; name: string; status: string; credit_limit: number; credit_currency: string; payment_terms_days: number };
type Contact = { id: string; name: string; title: string | null; email: string | null; phone: string | null; is_primary: number };
type Address = { id: string; label: string; type: string; country_code: string; city: string; address_line1: string; is_default: number };

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireSessionUser(request, undefined, "portal");
  const customer = await env.DB.prepare(`SELECT c.id, c.code, c.name, c.status, c.credit_limit, c.credit_currency, c.payment_terms_days FROM customer_portal_accounts cpa JOIN customers c ON c.id = cpa.customer_id WHERE cpa.user_id = ? AND cpa.organization_id = ? AND cpa.status = 'active' LIMIT 1`).bind(user.userId, user.organizationId).first<CustomerSummary>();
  if (!customer) throw new Response("客户门户账户未关联客户", { status: 403 });
  const [contacts, addresses] = await Promise.all([
    env.DB.prepare("SELECT id, name, title, email, phone, is_primary FROM customer_contacts WHERE customer_id = ? ORDER BY is_primary DESC, name").bind(customer.id).all<Contact>(),
    env.DB.prepare("SELECT id, label, type, country_code, city, address_line1, is_default FROM customer_addresses WHERE customer_id = ? ORDER BY is_default DESC, label").bind(customer.id).all<Address>(),
  ]);
  return { user, customer, contacts: contacts.results, addresses: addresses.results };
}

export function meta() { return [{ title: "客户门户 | International TMS" }]; }

export default function PortalIndex({ loaderData }: Route.ComponentProps) {
  return <><header className="page-header portal-hero"><div><p className="eyebrow">CUSTOMER PORTAL</p><h1>{loaderData.customer.name}</h1><p>客户代码 {loaderData.customer.code} · 账户状态 {loaderData.customer.status === "active" ? "正常" : loaderData.customer.status}</p></div><span className="status-pill">门户已启用</span></header>
    <section className="stats"><article><span>联系人</span><strong>{loaderData.contacts.length}</strong><small>已备案联系人</small></article><article><span>收发货地址</span><strong>{loaderData.addresses.length}</strong><small>常用地址</small></article><article><span>账期</span><strong>{loaderData.customer.payment_terms_days}</strong><small>天</small></article></section>
    <section className="portal-grid"><article className="panel"><h2>联系人</h2>{loaderData.contacts.length ? <div className="simple-list">{loaderData.contacts.map(contact => <div key={contact.id}><div><strong>{contact.name}</strong><small>{contact.title || "联系人"}</small></div><span>{contact.email || contact.phone || "—"}</span></div>)}</div> : <p className="empty-state">暂无联系人，请联系客户经理维护。</p>}</article><article className="panel"><h2>常用地址</h2>{loaderData.addresses.length ? <div className="simple-list">{loaderData.addresses.map(address => <div key={address.id}><div><strong>{address.label}</strong><small>{address.country_code} · {address.city}</small></div><span>{address.address_line1}</span></div>)}</div> : <p className="empty-state">暂无常用地址。</p>}</article></section>
  </>;
}
