import { env } from "cloudflare:workers";
import { Form, useNavigation } from "react-router";
import type { Route } from "./+types/admin.billing";
import { requireSessionUser } from "../lib/auth.server";
import { nextDocumentNumber } from "../lib/documents.server";
import { canTransition, nextStates } from "../lib/workflow";
import { valueOf } from "../lib/validation";
import { writeAudit } from "../lib/audit.server";

type Invoice = { id:string; invoice_number:string; customer_name:string; shipment_number:string|null; currency:string; subtotal:number; tax_amount:number; total_amount:number; paid_amount:number; issue_date:string|null; due_date:string|null; status:string; notes:string|null; lines:string|null; created_at:string };

export async function loader({request}:Route.LoaderArgs){
  const current=await requireSessionUser(request,"billing.view");
  const [invoices,shipments,customers,currencies]=await Promise.all([
    env.DB.prepare(`SELECT i.id,i.invoice_number,c.name AS customer_name,s.shipment_number,i.currency,i.subtotal,i.tax_amount,i.total_amount,i.paid_amount,i.issue_date,i.due_date,i.status,i.notes,i.created_at,GROUP_CONCAT(il.description||': '||il.amount,'；') AS lines FROM invoices i JOIN customers c ON c.id=i.customer_id LEFT JOIN shipments s ON s.id=i.shipment_id LEFT JOIN invoice_lines il ON il.invoice_id=i.id WHERE i.organization_id=? GROUP BY i.id ORDER BY i.created_at DESC LIMIT 250`).bind(current.organizationId).all<Invoice>(),
    env.DB.prepare(`SELECT s.id,s.shipment_number,s.customer_id,c.name AS customer_name FROM shipments s JOIN customers c ON c.id=s.customer_id WHERE s.organization_id=? AND s.status='delivered' AND NOT EXISTS(SELECT 1 FROM invoices i WHERE i.shipment_id=s.id AND i.status!='void') ORDER BY s.actual_delivery_at DESC`).bind(current.organizationId).all<{id:string;shipment_number:string;customer_id:string;customer_name:string}>(),
    env.DB.prepare("SELECT id,code,name FROM customers WHERE organization_id=? AND status='active' ORDER BY name").bind(current.organizationId).all<{id:string;code:string;name:string}>(),
    env.DB.prepare("SELECT code,name FROM reference_data WHERE organization_id=? AND category='currency' AND status='active' ORDER BY sort_order").bind(current.organizationId).all<{code:string;name:string}>(),
  ]);
  return {current,invoices:invoices.results,shipments:shipments.results,customers:customers.results,currencies:currencies.results};
}

export async function action({request}:Route.ActionArgs){
  const current=await requireSessionUser(request,"billing.manage");
  const form=await request.formData(),intent=valueOf(form,"intent"),now=new Date().toISOString();
  if(intent==="status"){
    const id=valueOf(form,"id"),status=valueOf(form,"status"),paid=Number(valueOf(form,"paidAmount")||0);
    const invoice=await env.DB.prepare("SELECT status,total_amount,paid_amount FROM invoices WHERE id=? AND organization_id=?").bind(id,current.organizationId).first<{status:string;total_amount:number;paid_amount:number}>();
    if(!invoice||!canTransition("invoice",invoice.status,status))return {formError:"账单状态流转无效"};
    const paidAmount=status==="paid"?invoice.total_amount:status==="partially_paid"?paid:invoice.paid_amount;
    if(paidAmount<0||paidAmount>invoice.total_amount||(status==="partially_paid"&&(paidAmount<=0||paidAmount>=invoice.total_amount)))return {formError:"收款金额无效"};
    const issueDate=status==="issued"?now.slice(0,10):null;
    await env.DB.prepare("UPDATE invoices SET status=?,paid_amount=?,issue_date=COALESCE(issue_date,?),updated_at=? WHERE id=? AND organization_id=?").bind(status,paidAmount,issueDate,now,id,current.organizationId).run();
    await writeAudit({request,action:"invoice.status",resourceType:"invoice",resourceId:id,organizationId:current.organizationId,actorUserId:current.userId,metadata:{from:invoice.status,to:status,paidAmount}});
    return {success:"账单状态已更新"};
  }
  const shipmentId=valueOf(form,"shipmentId"),formCustomerId=valueOf(form,"customerId"),currency=valueOf(form,"currency")||"USD",dueDate=valueOf(form,"dueDate"),notes=valueOf(form,"notes");
  const freight=Number(valueOf(form,"freight")||0),surcharge=Number(valueOf(form,"surcharge")||0),taxRate=Number(valueOf(form,"taxRate")||0);
  const shipment=shipmentId?await env.DB.prepare("SELECT customer_id FROM shipments WHERE id=? AND organization_id=? AND status='delivered'").bind(shipmentId,current.organizationId).first<{customer_id:string}>():null;
  const customerId=shipment?.customer_id??formCustomerId;
  if(!(await env.DB.prepare("SELECT 1 FROM customers WHERE id=? AND organization_id=?").bind(customerId,current.organizationId).first()))return {formError:"客户无效"};
  if(shipmentId&&!shipment)return {formError:"运单无效或尚未签收"};
  if([freight,surcharge,taxRate].some(v=>!Number.isFinite(v)||v<0)||freight+surcharge<=0)return {formError:"请填写有效账单金额"};
  const subtotal=freight+surcharge,tax=Number((subtotal*taxRate/100).toFixed(2)),total=subtotal+tax,id=crypto.randomUUID(),number=await nextDocumentNumber(current.organizationId,"invoice");
  const statements=[env.DB.prepare("INSERT INTO invoices(id,organization_id,invoice_number,customer_id,shipment_id,currency,subtotal,tax_amount,total_amount,due_date,notes,created_by_user_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(id,current.organizationId,number,customerId,shipmentId||null,currency,subtotal,tax,total,dueDate||null,notes||null,current.userId,now,now),env.DB.prepare("INSERT INTO invoice_lines(id,invoice_id,description,quantity,unit_price,amount,sort_order,created_at) VALUES(?,?,'运输服务费',1,?,?,10,?)").bind(crypto.randomUUID(),id,freight,freight,now)];
  if(surcharge>0)statements.push(env.DB.prepare("INSERT INTO invoice_lines(id,invoice_id,description,quantity,unit_price,amount,sort_order,created_at) VALUES(?,?,'运输附加费',1,?,?,20,?)").bind(crypto.randomUUID(),id,surcharge,surcharge,now));
  await env.DB.batch(statements);
  await writeAudit({request,action:"invoice.create",resourceType:"invoice",resourceId:id,organizationId:current.organizationId,actorUserId:current.userId,metadata:{number,total}});
  return {success:`账单 ${number} 已创建`};
}

export function meta(){return[{title:"应收账单 | International TMS"}]}
const labels:Record<string,string>={draft:"草稿",issued:"已开具",partially_paid:"部分收款",paid:"已付清",overdue:"逾期",void:"已作废"};
export default function Billing({loaderData,actionData}:Route.ComponentProps){
  const busy=useNavigation().state!=="idle",manage=loaderData.current.permissions.includes("billing.manage");
  const outstanding=loaderData.invoices.filter(i=>["issued","partially_paid","overdue"].includes(i.status)).reduce((s,i)=>s+i.total_amount-i.paid_amount,0);
  return <><header className="page-header"><div><p className="eyebrow">ACCOUNTS RECEIVABLE</p><h1>应收账单</h1><p>从签收运单生成账单，管理开票、到期和收款状态。</p></div><span className="status-pill">未收 {outstanding.toLocaleString()}</span></header>{(actionData?.success||actionData?.formError)&&<div className={`alert ${actionData.formError?"error":"success"}`}>{actionData.formError??actionData.success}</div>}
    {manage&&<details className="panel expandable" open={loaderData.invoices.length===0}><summary>创建应收账单</summary><Form method="post" className="form-grid"><input type="hidden" name="intent" value="create"/><Sel label="已签收运单" name="shipmentId" optional items={loaderData.shipments.map(s=>[s.id,`${s.shipment_number} · ${s.customer_name}`])}/><Sel label="客户（无运单时）" name="customerId" optional items={loaderData.customers.map(c=>[c.id,`${c.code} · ${c.name}`])}/><Sel label="币种" name="currency" items={loaderData.currencies.map(c=>[c.code,c.code])}/><Num label="运输服务费" name="freight"/><Num label="附加费" name="surcharge"/><Num label="税率（%）" name="taxRate"/><label className="field"><span>到期日</span><input name="dueDate" type="date"/></label><label className="field span-2"><span>备注</span><input name="notes"/></label><button className="primary" disabled={busy}>创建账单</button></Form></details>}
    <section className="stats"><article><span>账单数量</span><strong>{loaderData.invoices.length}</strong><small>当前组织</small></article><article><span>待收账单</span><strong>{loaderData.invoices.filter(i=>["issued","partially_paid","overdue"].includes(i.status)).length}</strong><small>需要跟进</small></article><article><span>未收余额</span><strong>{Math.round(outstanding).toLocaleString()}</strong><small>多币种汇总展示</small></article></section>
    <section className="panel"><div className="table-wrap"><table><thead><tr><th>账单/客户</th><th>运单</th><th>费用明细</th><th>金额</th><th>日期</th><th>状态</th></tr></thead><tbody>{loaderData.invoices.map(i=><tr key={i.id}><td><strong>{i.invoice_number}</strong><small>{i.customer_name}</small></td><td>{i.shipment_number||"独立账单"}</td><td>{i.lines||"—"}</td><td><strong>{i.currency} {i.total_amount.toLocaleString()}</strong><small>已收 {i.paid_amount.toLocaleString()}</small></td><td><strong>{i.issue_date||"未开具"}</strong><small>到期 {i.due_date||"未设"}</small></td><td>{manage&&nextStates("invoice",i.status).length?<Form method="post" className="inline-form"><input type="hidden" name="intent" value="status"/><input type="hidden" name="id" value={i.id}/><select name="status" defaultValue=""><option value="" disabled>{labels[i.status]}</option>{nextStates("invoice",i.status).map(s=><option key={s} value={s}>{labels[s]}</option>)}</select><input className="mini-input" name="paidAmount" type="number" min="0" step="0.01" placeholder="收款金额"/><button className="text-button">更新</button></Form>:<span className="status-pill">{labels[i.status]}</span>}</td></tr>)}</tbody></table></div></section>
  </>;
}
function Sel({label,name,items,optional}:{label:string;name:string;items:[string,string][];optional?:boolean}){return <label className="field"><span>{label}</span><select name={name} required={!optional}><option value="">{optional?"未指定":"请选择"}</option>{items.map(([v,t])=><option key={v} value={v}>{t}</option>)}</select></label>}
function Num({label,name}:{label:string;name:string}){return <label className="field"><span>{label}</span><input name={name} type="number" min="0" step="0.01" defaultValue="0"/></label>}
