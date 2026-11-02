export type AdminOrder = {
  id: string; order_number: string; customer_email: string; currency: string; amount: number;
  order_status: string; payment_status: string; fulfilment_status: string; created_at: string;
  issuance_status: string | null; last4: string | null;
};
export default function OrderTable({ orders, action, canReview = false }: { orders: AdminOrder[]; action?: (order: AdminOrder) => void; canReview?: boolean }) {
  return <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Order</th><th>Customer</th><th>Amount</th><th>Payment</th><th>Fulfilment</th><th>Created</th>{canReview && <th>Action</th>}</tr></thead>
    <tbody>{orders.map((order) => <tr key={order.id}><td><strong>{order.order_number}</strong><small>{order.order_status.replaceAll("_", " ")}</small></td><td>{order.customer_email}</td><td>{order.currency} {Number(order.amount).toFixed(2)}</td><td>{order.payment_status.replaceAll("_", " ")}</td><td>{order.fulfilment_status.replaceAll("_", " ")}{order.last4 ? <small>•••• {order.last4}</small> : null}</td><td>{new Date(order.created_at).toLocaleDateString()}</td>{canReview && <td>{order.payment_status === "successful" && order.fulfilment_status !== "completed" && action ? <button onClick={() => action(order)}>Review</button> : "—"}</td>}</tr>)}
    {!orders.length && <tr><td colSpan={canReview ? 7 : 6}>No orders found.</td></tr>}</tbody></table></div>;
}