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
  const [verificationOrderId, setVerificationOrderId] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const [customerOrders, setCustomerOrders] = useState<Array<{ orderId: string; orderNumber: string; currency: string; amount: number; status: string; paymentStatus: string; fulfilmentStatus: string }>>([]);

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
    if (callbackOrderId) {
      void refreshOrderStatus(callbackOrderId);
      void refreshCustomerOrders();
    }
  }, [callbackOrderId]);

  async function refreshCustomerOrders() {
    try {
      const response = await fetch("/api/customer/orders");
      if (!response.ok) return;
      const payload = await response.json() as { orders: typeof customerOrders };
      setCustomerOrders(payload.orders);
    } catch { /* Customer order history is optional until an email session exists. */ }
  }

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
      setVerificationOrderId(created.orderId);
      const otpResponse = await fetch("/api/customer/otp/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: created.orderId }),
      });
      const otpResult = await otpResponse.json() as { error?: string };
      if (!otpResponse.ok) throw new Error(otpResult.error ?? "Unable to send the verification code.");
      setOtpSent(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Checkout could not be started.");
    } finally {
      setLoading(false);
    }
  }

  async function verifyEmailAndContinue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!verificationOrderId) return;
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/customer/otp/verify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: verificationOrderId, code: otp }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Email verification failed.");
      setEmailVerified(true);
      const paymentResponse = await fetch("/api/payments/flutterwave/initialize", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: verificationOrderId }),
      });
      const payment = await paymentResponse.json() as { paymentUrl?: string; error?: string };
      if (!paymentResponse.ok || !payment.paymentUrl) throw new Error(payment.error ?? "Unable to start payment.");
      window.location.assign(payment.paymentUrl);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to verify email and start payment.");
    } finally { setLoading(false); }
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

      {verificationOrderId && !emailVerified && !callbackMode ? (
        <section className="purchase" id="verify-email">
          <p className="eyebrow">EMAIL VERIFICATION</p>
          <h2>Check your inbox</h2>
          <p className="muted">{otpSent ? `We sent a six-digit verification code to ${email}.` : `We could not send a code to ${email} yet. Request a new code below.`} Verify that you own this email address before continuing to secure payment.</p>
          {otpSent && <form onSubmit={verifyEmailAndContinue}>
            <label className="field-label" htmlFor="otp">Six-digit verification code</label>
            <input id="otp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" />
            <button className="primary-button" type="submit" disabled={loading || otp.length !== 6}>{loading ? "Verifying…" : "Verify email and continue to payment"}</button>
          </form>}
          <button className="secondary-button" type="button" disabled={loading} onClick={async () => { setError(""); const response = await fetch("/api/customer/otp/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: verificationOrderId }) }); const result = await response.json() as { error?: string }; if (!response.ok) setError(result.error ?? "Unable to resend code."); else { setOtpSent(true); setError("A new verification code has been sent."); } }}>Resend verification code</button>
          {error && <p className="error" role="alert">{error}</p>}
          <p className="notice">The code expires after 10 minutes. Payment cannot start until email ownership is verified.</p>
        </section>
      ) : callbackMode ? (
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
          {customerOrders.length > 0 && <div className="status-panel" id="my-card"><h3>Your orders</h3>{customerOrders.map((item) => <p key={item.orderId}><strong>{item.orderNumber}</strong> · {item.currency} {item.amount} · {item.paymentStatus} · {item.fulfilmentStatus}</p>)}</div>}
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