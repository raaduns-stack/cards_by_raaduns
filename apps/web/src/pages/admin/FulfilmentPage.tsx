export type FulfilmentItem = {
  id: string; order_number: string; customer_email: string; card_amount_usd: number | string | null;
  payment_currency: string; payment_amount_ngn: number | string | null; fulfilment_status: string;
  order_status: string; provider: string | null; issuance_status: string | null;
  provider_reference: string | null; provider_order_id: string | null; provider_card_id: string | null;
  last4: string | null; created_at: string; issuance_updated_at: string | null;
};
const value = (input: string | null | undefined) => input || "—";
export default function FulfilmentPage({ items }: { items: FulfilmentItem[] }) {
  return <>
    <div className="admin-metrics">
      <article><span>Payment-verified orders</span><strong>{items.length}</strong></article>
      <article><span>Needs attention</span><strong>{items.filter((item) => ["manual_review", "failed"].includes(item.fulfilment_status)).length}</strong></article>
      <article><span>Provider pending</span><strong>{items.filter((item) => item.fulfilment_status === "processing").length}</strong></article>
    </div>
    <div className="admin-section-heading"><div><h2>Fulfilment queue</h2><p className="admin-muted">Payment-verified orders only. Provider references and masked card suffixes are shown; card secrets are never displayed.</p></div></div>
    <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Order / customer</th><th>Card value</th><th>Fulfilment</th><th>Provider issuance</th><th>Provider reference</th><th>Card</th><th>Last updated</th></tr></thead><tbody>
      {items.map((item) => <tr key={item.id}><td><strong>{item.order_number}</strong><small>{item.customer_email}</small></td><td>{item.card_amount_usd == null ? "—" : `USD ${Number(item.card_amount_usd).toFixed(2)}`}</td><td><span className={`admin-status ${item.fulfilment_status}`}>{item.fulfilment_status.replaceAll("_", " ")}</span></td><td>{value(item.issuance_status)}<small>{value(item.provider)}</small></td><td>{value(item.provider_reference)}<small>Order ID: {value(item.provider_order_id)}</small></td><td>{item.last4 ? `•••• ${item.last4}` : item.provider_card_id ? "Issued" : "—"}</td><td>{item.issuance_updated_at ? new Date(item.issuance_updated_at).toLocaleString() : new Date(item.created_at).toLocaleString()}</td></tr>)}
      {!items.length && <tr><td colSpan={7}>No payment-verified orders in the fulfilment queue.</td></tr>}
    </tbody></table></div>
    <p className="admin-muted">Pending issuance is polled by the protected server job. Do not retry card creation manually when a provider request may already be pending.</p>
  </>;
}

[executed on device: mail.quicrefill.com (657bc0f0-b268-4295-8ef1-fac3aa0eceb5)]