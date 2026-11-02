export type AdminCustomer = {
  id: number; email: string; email_verified_at: string; created_at: string;
  order_count: number; paid_order_count: number; issued_card_count: number; last_order_at: string | null;
};
export type CustomerOrder = {
  id: string; order_number: string; card_amount_usd: number | string | null;
  payment_currency: string; payment_amount: number | string; order_status: string;
  payment_status: string; fulfilment_status: string; created_at: string;
  issuance_status: string | null; last4: string | null; provider: string | null;
};
export type CustomerDetail = { customer: Pick<AdminCustomer, "id" | "email" | "email_verified_at" | "created_at">; orders: CustomerOrder[] };
const date = (value: string | null) => value ? new Date(value).toLocaleString() : "—";
const status = (value: string) => value.replaceAll("_", " ");
export default function CustomersPage({ customers, search, onSearch, onApply, page, total, onPage, selected, onOpen, onClose }: {
  customers: AdminCustomer[]; search: string; onSearch: (value: string) => void;
  onApply: () => void; page: number; total: number; onPage: (page: number) => void; selected: CustomerDetail | null; onOpen: (id: number) => void; onClose: () => void;
}) {
  return <>
    <div className="admin-filters"><input aria-label="Search customers" placeholder="Search verified customer email" type="search" value={search} onChange={(event) => onSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") onApply(); }} /><button onClick={onApply}>Search customers</button></div>
    {selected && <section className="admin-panel" style={{ marginBottom: 24 }}>
      <div className="admin-section-heading"><div><p className="admin-eyebrow">VERIFIED CUSTOMER</p><h2>{selected.customer.email}</h2><p className="admin-muted">Email verified {date(selected.customer.email_verified_at)} · Customer since {date(selected.customer.created_at)}</p></div><button onClick={onClose}>Close details</button></div>
      <h3>Order and card associations</h3>
      <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Order</th><th>Card face value</th><th>Payment</th><th>Fulfilment</th><th>Issuance</th><th>Card suffix</th><th>Created</th></tr></thead><tbody>
        {selected.orders.map((order) => <tr key={order.id}><td><strong>{order.order_number}</strong><small>{order.id}</small></td><td>{order.card_amount_usd == null ? "—" : `USD ${Number(order.card_amount_usd).toFixed(2)}`}</td><td><span className={`admin-status ${order.payment_status}`}>{status(order.payment_status)}</span><small>{order.payment_currency} {Number(order.payment_amount).toFixed(2)}</small></td><td>{status(order.fulfilment_status)}</td><td>{status(order.issuance_status ?? "not issued")}</td><td>{order.last4 ? `•••• ${order.last4}` : "—"}</td><td>{date(order.created_at)}</td></tr>)}
        {!selected.orders.length && <tr><td colSpan={7}>No orders are associated with this verified customer.</td></tr>}
      </tbody></table></div>
    </section>}
    <div className="admin-section-heading"><div><h2>Customer records</h2><p className="admin-muted">Only customers who have verified control of their email are listed.</p></div></div>
    <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Customer</th><th>Orders</th><th>Paid orders</th><th>Card records</th><th>Last order</th><th>Joined</th><th></th></tr></thead><tbody>
      {customers.map((customer) => <tr key={customer.id}><td><strong>{customer.email}</strong><small>Email verified {date(customer.email_verified_at)}</small></td><td>{customer.order_count}</td><td>{customer.paid_order_count}</td><td>{customer.issued_card_count}</td><td>{date(customer.last_order_at)}</td><td>{date(customer.created_at)}</td><td><button onClick={() => onOpen(customer.id)}>View customer</button></td></tr>)}
      {!customers.length && <tr><td colSpan={7}>No verified customer records found.</td></tr>}
    </tbody></table></div>
    <div className="admin-filters" style={{ justifyContent: "space-between", marginTop: 16 }}><span className="admin-muted">Showing {total === 0 ? 0 : (page - 1) * 50 + 1}–{Math.min(page * 50, total)} of {total} customers</span><div><button disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button><button disabled={page * 50 >= total} onClick={() => onPage(page + 1)}>Next</button></div></div>
  </>;
}
