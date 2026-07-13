import { env } from "cloudflare:workers";
import { Form, useNavigation } from "react-router";
import type { Route } from "./+types/admin.shipments";
import { requireSessionUser } from "../lib/auth.server";
import { nextDocumentNumber } from "../lib/documents.server";
import { canTransition, nextStates } from "../lib/workflow";
import { validateCode, validateEmail, valueOf } from "../lib/validation";
import { writeAudit } from "../lib/audit.server";

type Shipment = { id: string; shipment_number: string; order_number: string; customer_name: string; status: string; current_location: string | null; estimated_delivery_at: string | null; actual_pickup_at: string | null; actual_delivery_at: string | null; signed_by: string | null; exception_reason: string | null; origin_city: string; destination_city: string; cargo_description: string; updated_at: string };
type Event = { id: string; shipment_id: string; status: string; location: string | null; description: string; event_at: string; visible_to_customer: number };
type Leg = { id: string; shipment_id: string; sequence_no: number; carrier_name: string | null; origin_location: string; destination_location: string; status: string; planned_departure_at: string | null; planned_arrival_at: string | null };

export async function loader({ request }: Route.LoaderArgs) {
  const current = await requireSessionUser(request, "shipment.view");
  const [shipments, orders, carriers, events, legs] = await Promise.all([
    env.DB.prepare(`SELECT s.id, s.shipment_number, o.order_number, c.name AS customer_name, s.status, s.current_location, s.estimated_delivery_at, s.actual_pickup_at, s.actual_delivery_at, s.signed_by, s.exception_reason, o.origin_city, o.destination_city, o.cargo_description, s.updated_at FROM shipments s JOIN transport_orders o ON o.id = s.order_id JOIN customers c ON c.id = s.customer_id WHERE s.organization_id = ? ORDER BY s.updated_at DESC LIMIT 250`).bind(current.organizationId).all<Shipment>(),
    env.DB.prepare(`SELECT o.id, o.order_number, c.name AS customer_name FROM transport_orders o JOIN customers c ON c.id = o.customer_id WHERE o.organization_id = ? AND o.status = 'confirmed' AND NOT EXISTS (SELECT 1 FROM shipments s WHERE s.order_id = o.id) ORDER BY o.confirmed_at DESC`).bind(current.organizationId).all<{ id: string; order_number: string; customer_name: string }>(),
    env.DB.prepare("SELECT id, code, name, status FROM carriers WHERE organization_id = ? ORDER BY name").bind(current.organizationId).all<{ id: string; code: string; name: string; status: string }>(),
    env.DB.prepare(`SELECT e.id, e.shipment_id, e.status, e.location, e.description, e.event_at, e.visible_to_customer FROM shipment_events e JOIN shipments s ON s.id = e.shipment_id WHERE s.organization_id = ? ORDER BY e.event_at DESC LIMIT 500`).bind(current.organizationId).all<Event>(),
    env.DB.prepare(`SELECT l.id, l.shipment_id, l.sequence_no, c.name AS carrier_name, l.origin_location, l.destination_location, l.status, l.planned_departure_at, l.planned_arrival_at FROM shipment_legs l JOIN shipments s ON s.id = l.shipment_id LEFT JOIN carriers c ON c.id = l.carrier_id WHERE s.organization_id = ? ORDER BY l.shipment_id, l.sequence_no`).bind(current.organizationId).all<Leg>(),
  ]);
  return { current, shipments: shipments.results, orders: orders.results, carriers: carriers.results, events: events.results, legs: legs.results };
}

export async function action({ request }: Route.ActionArgs) {
  const current = await requireSessionUser(request, "shipment.manage");
  const form = await request.formData(), intent = valueOf(form, "intent"), now = new Date().toISOString();
  if (intent === "carrier") {
    const code = valueOf(form, "code").toLowerCase(), name = valueOf(form, "name"), scac = valueOf(form, "scac").toUpperCase(), contactName = valueOf(form, "contactName"), phone = valueOf(form, "phone"), email = valueOf(form, "email").toLowerCase();
    if (validateCode(code) || name.length < 2 || (email && validateEmail(email))) return { formError: "请填写有效承运商代码、名称和邮箱" };
    const id = crypto.randomUUID();
    try { await env.DB.prepare("INSERT INTO carriers (id, organization_id, code, name, scac, contact_name, contact_phone, contact_email, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, current.organizationId, code, name, scac || null, contactName || null, phone || null, email || null, now, now).run(); } catch { return { formError: "承运商代码不能重复" }; }
    await writeAudit({ request, action: "carrier.create", resourceType: "carrier", resourceId: id, organizationId: current.organizationId, actorUserId: current.userId, metadata: { code } });
    return { success: "承运商已创建" };
  }
  if (intent === "create") {
    const orderId = valueOf(form, "orderId"), tracking = valueOf(form, "tracking"), eta = valueOf(form, "eta");
    const order = await env.DB.prepare("SELECT customer_id, origin_city FROM transport_orders WHERE id = ? AND organization_id = ? AND status = 'confirmed' AND NOT EXISTS (SELECT 1 FROM shipments WHERE order_id = transport_orders.id)").bind(orderId, current.organizationId).first<{ customer_id: string; origin_city: string }>();
    if (!order) return { formError: "订单无效、未确认或已生成运单" };
    const id = crypto.randomUUID(), number = await nextDocumentNumber(current.organizationId, "shipment");
    await env.DB.batch([
      env.DB.prepare("INSERT INTO shipments (id, organization_id, shipment_number, order_id, customer_id, master_tracking_number, current_location, estimated_delivery_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, current.organizationId, number, orderId, order.customer_id, tracking || null, order.origin_city, eta || null, now, now),
      env.DB.prepare("INSERT INTO shipment_events (id, shipment_id, status, location, description, event_at, created_by_user_id, created_at) VALUES (?, ?, 'booked', ?, '运单已创建，等待提货', ?, ?, ?)").bind(crypto.randomUUID(), id, order.origin_city, now, current.userId, now),
      env.DB.prepare("UPDATE transport_orders SET status = 'in_execution', updated_at = ? WHERE id = ? AND organization_id = ?").bind(now, orderId, current.organizationId),
    ]);
    await writeAudit({ request, action: "shipment.create", resourceType: "shipment", resourceId: id, organizationId: current.organizationId, actorUserId: current.userId, metadata: { number, orderId } });
    return { success: `运单 ${number} 已创建` };
  }
  if (intent === "leg") {
    const shipmentId = valueOf(form, "shipmentId"), carrierId = valueOf(form, "carrierId"), origin = valueOf(form, "origin"), destination = valueOf(form, "destination"), departure = valueOf(form, "departure"), arrival = valueOf(form, "arrival"), reference = valueOf(form, "reference");
    if (!(await ownedShipment(shipmentId, current.organizationId)) || !origin || !destination) return { formError: "运单或运输分段信息无效" };
    if (carrierId && !(await env.DB.prepare("SELECT 1 FROM carriers WHERE id = ? AND organization_id = ? AND status = 'active'").bind(carrierId, current.organizationId).first())) return { formError: "承运商无效" };
    const row = await env.DB.prepare("SELECT COALESCE(MAX(sequence_no), 0) + 1 AS sequence_no FROM shipment_legs WHERE shipment_id = ?").bind(shipmentId).first<{ sequence_no: number }>();
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO shipment_legs (id, shipment_id, sequence_no, carrier_id, carrier_reference, origin_location, destination_location, planned_departure_at, planned_arrival_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, shipmentId, row?.sequence_no ?? 1, carrierId || null, reference || null, origin, destination, departure || null, arrival || null, now, now).run();
    await writeAudit({ request, action: "shipment.leg.create", resourceType: "shipment_leg", resourceId: id, organizationId: current.organizationId, actorUserId: current.userId, metadata: { shipmentId } });
    return { success: "运输分段已添加" };
  }
  const id = valueOf(form, "id"), status = valueOf(form, "status"), location = valueOf(form, "location"), description = valueOf(form, "description"), eventAt = valueOf(form, "eventAt") || now, signedBy = valueOf(form, "signedBy"), exceptionReason = valueOf(form, "exceptionReason");
  const shipment = await env.DB.prepare("SELECT status, order_id FROM shipments WHERE id = ? AND organization_id = ?").bind(id, current.organizationId).first<{ status: string; order_id: string }>();
  if (!shipment || !canTransition("shipment", shipment.status, status) || !description) return { formError: "运单状态流转或轨迹说明无效" };
  const statements = [
    env.DB.prepare(`UPDATE shipments SET status = ?, current_location = COALESCE(NULLIF(?, ''), current_location), actual_pickup_at = CASE WHEN ? = 'picked_up' THEN ? ELSE actual_pickup_at END, actual_delivery_at = CASE WHEN ? = 'delivered' THEN ? ELSE actual_delivery_at END, signed_by = CASE WHEN ? = 'delivered' THEN ? ELSE signed_by END, exception_reason = CASE WHEN ? = 'exception' THEN ? ELSE exception_reason END, updated_at = ? WHERE id = ? AND organization_id = ?`).bind(status, location, status, eventAt, status, eventAt, status, signedBy || null, status, exceptionReason || description, now, id, current.organizationId),
    env.DB.prepare("INSERT INTO shipment_events (id, shipment_id, status, location, description, event_at, visible_to_customer, created_by_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), id, status, location || null, description, eventAt, form.has("internal") ? 0 : 1, current.userId, now),
  ];
  if (status === "delivered") statements.push(env.DB.prepare("UPDATE transport_orders SET status = 'completed', updated_at = ? WHERE id = ? AND organization_id = ?").bind(now, shipment.order_id, current.organizationId));
  await env.DB.batch(statements);
  await writeAudit({ request, action: "shipment.status", resourceType: "shipment", resourceId: id, organizationId: current.organizationId, actorUserId: current.userId, metadata: { from: shipment.status, to: status } });
  return { success: "运单状态与轨迹已更新" };
}
async function ownedShipment(id: string, org: string) { return env.DB.prepare("SELECT 1 FROM shipments WHERE id = ? AND organization_id = ?").bind(id, org).first(); }
export function meta() { return [{ title: "运单与轨迹 | International TMS" }]; }
const labels: Record<string,string> = { booked:"已订舱", picked_up:"已提货", in_transit:"运输中", customs:"清关中", out_for_delivery:"派送中", delivered:"已签收", exception:"异常", cancelled:"已取消" };

export default function Shipments({ loaderData, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle", manage = loaderData.current.permissions.includes("shipment.manage");
  return <><header className="page-header"><div><p className="eyebrow">SHIPMENT EXECUTION</p><h1>运单、调度与轨迹</h1><p>从订单生成运单，分配承运商并持续发布客户可见轨迹。</p></div><span className="status-pill">{loaderData.shipments.length} 票运单</span></header>{(actionData?.success || actionData?.formError) && <div className={`alert ${actionData.formError ? "error" : "success"}`}>{actionData.formError ?? actionData.success}</div>}
    {manage && <section className="action-grid"><details className="panel expandable" open={loaderData.shipments.length===0}><summary>从确认订单创建运单</summary><Form method="post" className="stack"><input type="hidden" name="intent" value="create"/><Sel name="orderId" label="确认订单" items={loaderData.orders.map(o=>[o.id,`${o.order_number} · ${o.customer_name}`])}/><label className="field"><span>主追踪号</span><input name="tracking"/></label><label className="field"><span>预计送达</span><input name="eta" type="datetime-local"/></label><button className="primary" disabled={busy}>创建运单</button></Form></details><details className="panel expandable"><summary>承运商档案</summary><Form method="post" className="stack"><input type="hidden" name="intent" value="carrier"/><label className="field"><span>代码</span><input name="code" required/></label><label className="field"><span>名称</span><input name="name" required/></label><label className="field"><span>SCAC</span><input name="scac"/></label><label className="field"><span>联系人</span><input name="contactName"/></label><label className="field"><span>电话</span><input name="phone"/></label><label className="field"><span>邮箱</span><input name="email" type="email"/></label><button className="primary" disabled={busy}>新增承运商</button></Form></details><details className="panel expandable"><summary>添加运输分段</summary><Form method="post" className="stack"><input type="hidden" name="intent" value="leg"/><Sel name="shipmentId" label="运单" items={loaderData.shipments.map(s=>[s.id,s.shipment_number])}/><Sel name="carrierId" label="承运商" optional items={loaderData.carriers.filter(c=>c.status==='active').map(c=>[c.id,c.name])}/><label className="field"><span>承运商参考号</span><input name="reference"/></label><label className="field"><span>起点</span><input name="origin" required/></label><label className="field"><span>终点</span><input name="destination" required/></label><label className="field"><span>计划发车</span><input name="departure" type="datetime-local"/></label><label className="field"><span>计划到达</span><input name="arrival" type="datetime-local"/></label><button className="primary" disabled={busy}>添加分段</button></Form></details></section>}
    {manage && loaderData.shipments.length>0 && <details className="panel expandable"><summary>更新运单状态与轨迹</summary><Form method="post" className="form-grid"><input type="hidden" name="intent" value="status"/><Sel name="id" label="运单" items={loaderData.shipments.filter(s=>nextStates('shipment',s.status).length).map(s=>[s.id,`${s.shipment_number} · ${labels[s.status]}`])}/><label className="field"><span>下一状态</span><select name="status" required><option value="">选择后续状态</option>{Object.entries(labels).map(([v,t])=><option key={v} value={v}>{t}</option>)}</select></label><label className="field"><span>当前位置</span><input name="location"/></label><label className="field"><span>发生时间</span><input name="eventAt" type="datetime-local"/></label><label className="field span-2"><span>轨迹说明</span><input name="description" required/></label><label className="field"><span>签收人</span><input name="signedBy"/></label><label className="field"><span>异常原因</span><input name="exceptionReason"/></label><label className="check-field"><input name="internal" type="checkbox"/>仅内部可见</label><button className="primary" disabled={busy}>发布轨迹</button></Form></details>}
    <section className="shipment-board">{loaderData.shipments.map(s=><article className="panel shipment-card" key={s.id}><header><div><strong>{s.shipment_number}</strong><small>{s.order_number} · {s.customer_name}</small></div><span className={`status-pill ${s.status==='exception'?'off':''}`}>{labels[s.status]}</span></header><p>{s.origin_city} → {s.destination_city} · {s.cargo_description}</p><div className="timeline">{loaderData.events.filter(e=>e.shipment_id===s.id).slice(0,6).map(e=><div key={e.id}><i></i><div><strong>{e.description}</strong><small>{e.location||'—'} · {new Date(e.event_at).toLocaleString('zh-CN')}{e.visible_to_customer?'':' · 内部'}</small></div></div>)}</div><footer>{loaderData.legs.filter(l=>l.shipment_id===s.id).map(l=><span key={l.id}>第 {l.sequence_no} 段 · {l.carrier_name||'待分配'} · {l.origin_location} → {l.destination_location}</span>)}</footer></article>)}</section>
  </>;
}
function Sel({label,name,items,optional}:{label:string;name:string;items:[string,string][];optional?:boolean}){return <label className="field"><span>{label}</span><select name={name} required={!optional}><option value="">{optional?'未指定':'请选择'}</option>{items.map(([v,t])=><option key={v} value={v}>{t}</option>)}</select></label>}
