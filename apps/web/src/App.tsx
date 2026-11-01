import { useEffect, useMemo, useState, type FormEvent } from "react";
import AdminApp from "./Admin.js";

type Catalog = {
  products: Array<{ id: number; code: string; name: string; network: string }>;
  currency: string;
  denominations: number[];
  customAmount: { enabled: boolean; min: number | null; max: number | null; step: number | null };
};
type OrderStatus = {
  orderNumber: string; currency: string; amount: number;
  status: string; paymentStatus: string; fulfilmentStatus: string;
};

function Storefront() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [selectedProduct, setSelectedProduct] = useState("");
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [order, setOrder] = useState<OrderStatus | null>(null);
  const [orderId, setOrderId] = useState("");
  const [checkingStatus, setCheckingStatus] = useState(false);

  const callbackOrderId = useMemo(() => {
    return window.location.pathname === "/payment/callback"
      ? new URLSearchParams(window.location.search).get("orderId") ?? ""
      : "";
  }, []);

  useEffect(() => {
    fetch("/api/catalog")
      .then(async (response) => {
        if (!response.ok) throw new Error("Card options are temporarily unavailable.");
        return response.json() as Promise<Catalog>;
      })
      .then((data) => {
        setCatalog(data);
        setSelectedProduct(data.products[0]?.code ?? "");
        setSelectedAmount(data.denominations[0] ?? null);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to load card options."));
  }, []);

  async function refreshOrderStatus(id: string) {
    setCheckingStatus(true);
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(id)}`);
      const payload = await response.json() as OrderStatus & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to retrieve order status.");
      setOrder(payload);
      setOrderId(id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to retrieve order status.");
    } finally {
      setCheckingStatus(false);
    }
  }

  useEffect(() => {
    if (callbackOrderId) void refreshOrderStatus(callbackOrderId);
  }, [callbackOrderId]);

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!catalog || !selectedProduct) return;
    const amount = catalog.customAmount.enabled && customAmount.trim()
      ? Number(customAmount)
      : selectedAmount;
    if (!amount || !Number.isFinite(amount)) {
      setError("Choose a card amount before continuing.");
      return;
    }
    setLoading(true);
    setError("");
    setOrder(null);
    try {
      const orderResponse = await fetch("/api/orders", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productCode: selectedProduct, amount, email }),
      });
      const created = await orderResponse.json() as { orderId?: string; error?: string };
      if (!orderResponse.ok || !created.orderId) throw new Error(created.error ?? "Unable to create your order.");
      setOrderId(created.orderId);
      const paymentResponse = await fetch("/api/payments/flutterwave/initialize", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: created.orderId }),
      });
      const payment = await paymentResponse.json() as { paymentUrl?: string; error?: string };
      if (!paymentResponse.ok || !payment.paymentUrl) throw new Error(payment.error ?? "Unable to start payment.");
      window.location.assign(payment.paymentUrl);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Checkout could not be started.");
    } finally {
      setLoading(false);
    }
  }

  const callbackMode = Boolean(callbackOrderId);
  return (
    <main className="page">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Cards by Raaduns home">
          <span className="brand-mark">R</span><span>Cards by Raaduns</span>
        </a>
        <nav aria-label="Main navigation">
          <a href="#buy">Buy Card</a><a href="#payment">Payment</a><a href="#my-card">Order Status</a>
        </nav>
      </header>

      <section className="hero">
        <p className="eyebrow">VIRTUAL PAYMENT CARDS</p>
        <h1>Your virtual Mastercard, ready for what’s next.</h1>
        <p className="intro">Choose an available amount, enter your email, and complete checkout through Flutterwave. Your card is issued after payment is verified.</p>
        <a className="primary-link" href="#buy">Explore card options</a>
      </section>

      {callbackMode ? (
        <section className="purchase" id="payment">
          <p className="eyebrow">PAYMENT RESULT</p><h2>Checking your order</h2>
          {checkingStatus && <p className="muted">Retrieving the latest verified status…</p>}
          {order && <div className="status-panel">
            <strong>{order.orderNumber}</strong>
            <p>{order.paymentStatus === "successful" ? "Payment verified." : "Payment is not yet confirmed."}</p>
            <span>Payment: {order.paymentStatus.replaceAll("_", " ")}</span>
            <span>Card fulfilment: {order.fulfilmentStatus.replaceAll("_", " ")}</span>
            <span>Order: {order.status.replaceAll("_", " ")}</span>
            <p className="notice">A card is issued only after the payment provider confirms the transaction.</p>
          </div>}
          {error && <p className="error" role="alert">{error}</p>}
          {orderId && <button className="primary-button" type="button" onClick={() => void refreshOrderStatus(orderId)} disabled={checkingStatus}>Refresh status</button>}
        </section>
      ) : (
        <section className="purchase" id="buy">
          <div>
            <p className="eyebrow">START AN ORDER</p><h2>Choose your card amount</h2>
            <p className="muted">Select a fixed USD denomination and provide the email address for your order.</p>
          </div>
          {!catalog && !error && <p className="muted">Loading available card options…</p>}
          {catalog && (
            <form onSubmit={submitOrder}>
              <label className="field-label" htmlFor="product">Card product</label>
              <select id="product" value={selectedProduct} onChange={(event) => setSelectedProduct(event.target.value)} required>
                {catalog.products.map((product) => <option key={product.code} value={product.code}>{product.name}</option>)}
              </select>
              <span className="field-label">Choose amount ({catalog.currency})</span>
              <div className="amount-grid">
                {catalog.denominations.map((amount) => (
                  <button className={selectedAmount === amount && !customAmount ? "amount selected" : "amount"} type="button" key={amount}
                    onClick={() => { setSelectedAmount(amount); setCustomAmount(""); }}>
                    <span className="currency">{catalog.currency}</span><strong>${amount}</strong>
                  </button>
                ))}
              </div>
              {catalog.customAmount.enabled && (
                <div className="custom-amount">
                  <label className="field-label" htmlFor="customAmount">Or enter a custom amount ({catalog.customAmount.min}–{catalog.customAmount.max}, step {catalog.customAmount.step})</label>
                  <input id="customAmount" type="number" min={catalog.customAmount.min ?? undefined} max={catalog.customAmount.max ?? undefined}
                    step={catalog.customAmount.step ?? "any"} value={customAmount}
                    onChange={(event) => setCustomAmount(event.target.value)} placeholder="Enter amount" />
                </div>
              )}
              <label className="field-label" htmlFor="email">Email address</label>
              <input id="email" type="email" autoComplete="email" maxLength={254} required value={email}
                onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
              <button className="primary-button" type="submit" disabled={loading || !catalog.products.length || !catalog.denominations.length}>
                {loading ? "Preparing checkout…" : "Continue to secure payment"}
              </button>
            </form>
          )}
          {error && <p className="error" role="alert">{error}</p>}
          <p className="notice">Card issuance starts only after payment verification. Card availability and issuance are subject to provider confirmation.</p>
        </section>
      )}

      <footer><span>© {new Date().getFullYear()} Cards by Raaduns</span><span>Secure virtual card services</span></footer>
    </main>
  );
}

export default function App() {
  return window.location.pathname.startsWith("/admin") ? <AdminApp /> : <Storefront />;
}
