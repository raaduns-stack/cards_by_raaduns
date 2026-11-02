import OrderTable, { type AdminOrder } from "./OrderTable.js";
type Props = { overview: { metrics: Record<string, number>; recentOrders: AdminOrder[] } | null };
export default function DashboardPage({ overview }: Props) {
  if (!overview) return <p className="admin-muted">Loading dashboard metrics…</p>;
  return <><div className="admin-metrics">{[["Total orders", overview.metrics.total_orders], ["Awaiting payment", overview.metrics.awaiting_payment], ["Payment verified", overview.metrics.paid], ["Manual review", overview.metrics.manual_review], ["Fulfilled", overview.metrics.fulfilled]].map(([label, value]) => <article className="admin-metric" key={String(label)}><span>{label}</span><strong>{Number(value ?? 0).toLocaleString()}</strong></article>)}</div><h2>Recent orders</h2><OrderTable orders={overview.recentOrders} /></>;
}