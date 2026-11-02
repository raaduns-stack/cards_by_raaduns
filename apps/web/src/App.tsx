import { useEffect, useMemo, useState, type FormEvent } from "react";
import AdminApp from "./Admin.js";

type Catalog = {
  products: Array<{ id: number; code: string; name: string; network: string }>;
  cardCurrency: string;
  paymentCurrency: string;
  pricing: { exchangeRateNgnPerUsd: number; issuanceFeeUsd: number; grossProfitNgn: number };
  denominations: Array<{ amountUsd: number; priceNgn: number }>;
  customAmount: { enabled: boolean; min: number | null; max: number | null; step: number | null };
  paymentMethods: { flutterwave: boolean; btcpay: boolean };
};
type OrderStatus = {
  orderNumber: string; paymentCurrency: string; paymentAmount: number; cardAmountUsd: number | null;
  status: string; paymentStatus: string; fulfilmentStatus: string;
};

function CardVisual({ network, comingSoon = false }: { network: "Mastercard" | "Visa"; comingSoon?: boolean }) {
  const mastercard = network === "Mastercard";
  return <div className={`payment-card ${mastercard ? "mastercard" : "visa"} ${comingSoon ? "muted-card" : ""}`}>
    <div className="card-top"><span className="card-chip"><i /></span><span className="card-type">VIRTUAL</span></div>
    <div className="card-number">•••• &nbsp; •••• &nbsp; •••• &nbsp; 2048</div>
    <div className="card-bottom"><span>RAADUNS</span>{mastercard ? <span className="mc-mark"><i /><i /></span> : <span className="visa-mark">VISA</span>}</div>
    {comingSoon && <span className="coming-soon">COMING SOON</span>}
  </div>;
}

function Storefront() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [selectedProduct, setSelectedProduct] = useState("");
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<"flutterwave" | "btcpay">("flutterwave");
  const [customAmount, setCustomAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [order, setOrder] = useState<OrderStatus | null>(null);
  const [orderId, setOrderId] = useState("");
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [customerEmail, setCustomerEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [customerVerified, setCustomerVerified] = useState(false);
  const [csrfToken, setCsrfToken] = useState("");
  const [customerOrders, setCustomerOrders] = useState<Array<{ id: string; order_number: string; payment_currency: string; payment_amount: number; card_amount_usd: number | null; order_status: string; payment_status: string; fulfilment_status: string; last4: string | null; latest_payment_provider?: string | null; latest_payment_status?: string | null; latest_payment_url?: string | null }>>([]);

  const callbackOrderId = useMemo(() => {
    return window.location.pathname === "/payment/callback"
      ? new URLSearchParams(window.location.search).get("orderId") ?? ""
      : "";
  }, []);

  useEffect(() => {
    fetch("/api/customer/auth/session", { credentials: "include" }).then(async (response) => {
      if (!response.ok) return;
      const session = await response.json() as { customer: { email: string }; csrfToken: string };
      setCustomerEmail(session.customer.email); setCsrfToken(session.csrfToken); setCustomerVerified(true); void loadCustomerOrders();
    }).catch(() => undefined);
    fetch("/api/catalog")
      .then(async (response) => {
        if (!response.ok) throw new Error("Card options are temporarily unavailable.");
        return response.json() as Promise<Catalog>;
      })
      .then((data) => {
        setCatalog(data);
        setSelectedProduct(data.products.find((product) => product.network.toLowerCase() === "mastercard")?.code ?? data.products[0]?.code ?? "");
        setSelectedAmount(data.denominations[0]?.amountUsd ?? null);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to load card options."));
  }, []);

  async function loadCustomerOrders() {
    const response = await fetch("/api/customer/orders", { credentials: "include" });
    if (!response.ok) return;
    const data = await response.json() as { orders: typeof customerOrders };
    setCustomerOrders(data.orders);
  }

  async function requestCode() {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/customer/auth/request-code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: customerEmail }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Unable to send sign-in code.");
      setOtpSent(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to send sign-in code."); }
    finally { setLoading(false); }
  }

  async function verifyCode() {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/customer/auth/verify-code", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ email: customerEmail, code: otp }) });
      const data = await response.json() as { error?: string; csrfToken?: string; customer?: { email: string } };
      if (!response.ok || !data.csrfToken) throw new Error(data.error ?? "Unable to verify code.");
      setCustomerVerified(true); setCustomerEmail(data.customer?.email ?? customerEmail); setCsrfToken(data.csrfToken); setOtp(""); await loadCustomerOrders();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to verify code."); }
    finally { setLoading(false); }
  }

  async function signOutCustomer() {
    await fetch("/api/customer/auth/logout", { method: "POST", credentials: "include", headers: { "x-csrf-token": csrfToken } });
    setCustomerVerified(false); setCsrfToken(""); setCustomerOrders([]); setOtpSent(false);
  }

  async function refreshOrderStatus(id: string) {
    setCheckingStatus(true);
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(id)}`, { credentials: "include" });
      const payload = await response.json() as OrderStatus & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to retrieve order status.");
      setOrder(payload);
      setOrderId(payload.paymentStatus === "successful" ? "" : id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to retrieve order status.");
    } finally {
      setCheckingStatus(false);
    }
  }

  useEffect(() => {
    if (!callbackOrderId || !customerVerified) return;
    void refreshOrderStatus(callbackOrderId);
    const timer = window.setInterval(() => { void refreshOrderStatus(callbackOrderId); }, 10000);
    return () => window.clearInterval(timer);
  }, [callbackOrderId, customerVerified]);

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
      let activeOrderId = orderId;
      if (!activeOrderId) {
        const orderResponse = await fetch("/api/orders", {
          method: "POST", credentials: "include", headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
          body: JSON.stringify({ productCode: selectedProduct, amount }),
        });
        const created = await orderResponse.json() as { orderId?: string; error?: string };
        if (!orderResponse.ok || !created.orderId) throw new Error(created.error ?? "Unable to create your order.");
        activeOrderId = created.orderId;
        setOrderId(activeOrderId);
      }
      const paymentResponse = await fetch(paymentMethod === "flutterwave" ? "/api/payments/flutterwave/initialize" : "/api/payments/btcpay/initialize", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify({ orderId: activeOrderId }),
      });
      const payment = await paymentResponse.json() as { paymentUrl?: string; error?: string };
      if (!paymentResponse.ok || !payment.paymentUrl) throw new Error(payment.error ?? "Unable to start payment.");
      await loadCustomerOrders();
      window.location.assign(payment.paymentUrl);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Checkout could not be started.");
    } finally {
      setLoading(false);
    }
  }

  const callbackMode = Boolean(callbackOrderId);
  const chosenAmount = catalog?.customAmount.enabled && customAmount.trim() ? Number(customAmount) : selectedAmount;

  async function handleCheckout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!customerVerified) {
      if (!customerEmail.trim()) { setError("Enter your email address to continue."); return; }
      if (!otpSent) await requestCode();
      else await verifyCode();
      return;
    }
    await submitOrder(event);
  }

  return (
    <main className="page-shell">
      <header className="site-header">
        <a className="brand" href="/" aria-label="Cards by Raaduns home"><span className="brand-icon">R</span><span>RAADUNS<span className="brand-light"> / CARDS</span></span></a>
        <span className="secure-note"><span className="secure-dot" />Secure checkout</span>
      </header>

      {callbackMode ? (
        <main className="status-page"><div className="status-panel"><a className="brand" href="/"><span className="brand-icon">R</span><span>RAADUNS / CARDS</span></a><h1>Payment status</h1>
          {!customerVerified ? <div className="callback-auth"><p>Sign in with the email used for this order to view its status.</p><input type="email" autoComplete="email" value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} placeholder="you@example.com" />{!otpSent ? <button className="continue-button" type="button" disabled={loading || !customerEmail.trim()} onClick={() => void requestCode()}>Email sign-in code</button> : <><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={(event) => setOtp(event.target.value)} placeholder="Six-digit code" /><button className="continue-button" type="button" disabled={loading || otp.length !== 6} onClick={() => void verifyCode()}>Verify email</button></>}</div> : checkingStatus ? <p className="notice">Checking your payment...</p> : order ? <><p>Order reference: {order.orderNumber}</p><p>Payment: {order.paymentStatus.replaceAll("_", " ")}</p><p>Card fulfilment: {order.fulfilmentStatus.replaceAll("_", " ")}</p><p>Card fulfilment begins after payment is verified.</p><button className="continue-button" type="button" onClick={() => void refreshOrderStatus(callbackOrderId)}>Refresh status</button></> : <p className="notice">Order status is not yet available.</p>}
          {error && <p className="notice error" role="alert">{error}</p>}<a className="back-link" href="/">Return to Cards by Raaduns</a>
        </div></main>
      ) : <>
        <section className="hero"><div className="hero-copy"><h1>Get Your Virtual Card Instantly</h1><p className="kyc-line">NO KYC REQUIRED</p></div><div className="cards-stage" aria-label="Virtual Mastercard and Visa card illustrations"><div className="card-wrap mastercard-wrap"><CardVisual network="Mastercard" /></div><div className="card-wrap visa-wrap"><CardVisual network="Visa" comingSoon /></div></div></section>
        <section className="purchase-panel" aria-labelledby="amount-heading"><div className="section-heading"><h2 id="amount-heading">Choose your card amount</h2><p>Select a USD card value</p></div>
          {!catalog && !error ? <p className="notice">Loading available card amounts...</p> : null}
          {error && !catalog && <p className="notice error" role="alert">{error}</p>}
          {catalog && <>
            <div className="denomination-grid">{catalog.denominations.map((item) => <button type="button" key={item.amountUsd} className={`denomination ${Number(chosenAmount) === Number(item.amountUsd) && !customAmount ? "selected" : ""}`} onClick={() => { setSelectedAmount(item.amountUsd); setCustomAmount(""); setOrderId(""); setError(""); }}><span className="usd-amount">${item.amountUsd}</span><span className="local-price">{item.priceNgn.toLocaleString("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 })}</span></button>)}</div>
            {catalog.customAmount.enabled && <div className="custom-row"><label htmlFor="custom-amount">Custom amount (USD)</label><input id="custom-amount" type="number" min={catalog.customAmount.min ?? undefined} max={catalog.customAmount.max ?? undefined} step={catalog.customAmount.step ?? 1} value={customAmount} onChange={(event) => { setCustomAmount(event.target.value); setOrderId(""); setError(""); }} placeholder={`${catalog.customAmount.min}–${catalog.customAmount.max}`} />{customAmount.trim() && Number.isFinite(Number(customAmount)) && Number(customAmount) >= Number(catalog.customAmount.min) && Number(customAmount) <= Number(catalog.customAmount.max) && Math.abs((Number(customAmount)-Number(catalog.customAmount.min))/Number(catalog.customAmount.step)-Math.round((Number(customAmount)-Number(catalog.customAmount.min))/Number(catalog.customAmount.step))) < 1e-8 && <small>{((((Number(customAmount)+catalog.pricing.issuanceFeeUsd)*catalog.pricing.exchangeRateNgnPerUsd)+catalog.pricing.grossProfitNgn)).toLocaleString("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 })}</small>}</div>}
            <form className="order-form" onSubmit={(event) => void handleCheckout(event)}>
              <label htmlFor="customer-email">Email address</label><div className="form-row"><input id="customer-email" type="email" autoComplete="email" required value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} readOnly={customerVerified || otpSent} placeholder="you@example.com" />
                <button className="continue-button" type="submit" disabled={loading || !chosenAmount || !customerEmail.trim()}>{loading ? "Processing..." : customerVerified ? (orderId ? "Retry payment" : "Continue to payment") : otpSent ? "Verify email" : "Continue to payment"}<span aria-hidden="true">→</span></button></div>
              {otpSent && !customerVerified && <div className="code-step"><label htmlFor="customer-otp">Enter the six-digit code sent to your email</label><input id="customer-otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={(event) => setOtp(event.target.value)} placeholder="000000" /><button className="auth-secondary" type="button" onClick={() => { setOtpSent(false); setOtp(""); setError(""); }}>Change email address</button></div>}
              {customerVerified && <p className="verified-note">Email verified: {customerEmail}</p>}
              {catalog.paymentMethods.btcpay && <div className="payment-method-row"><label htmlFor="payment-method">Payment method</label><select id="payment-method" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as "flutterwave" | "btcpay")}><option value="flutterwave">Bank transfer / card</option><option value="btcpay">Bitcoin / Litecoin</option></select></div>}
              {error && <p className="notice error" role="alert">{error}</p>}
            </form>
          </>}
          <p className="fine-print">Mastercard is available now. Visa is coming soon. Card value is issued in USD; payment is collected in the currency shown at checkout. Issuance begins only after payment is verified.</p>
        </section>
        {customerVerified && <section className="customer-orders" id="my-card"><div className="orders-heading"><div><p className="eyebrow">CUSTOMER ACCOUNT</p><h2>My orders</h2></div><button type="button" onClick={() => void loadCustomerOrders()}>Refresh</button></div>
          {customerOrders.length === 0 ? <p className="muted">No orders associated with this email yet.</p> : customerOrders.map((item) => <article className="customer-order" key={item.id}><div><strong>{item.order_number}</strong><span>Card: {item.card_amount_usd === null ? "Value pending" : "$" + Number(item.card_amount_usd).toFixed(2) + " USD"}</span><span>Pay: {Number(item.payment_amount).toLocaleString("en-NG", { style: "currency", currency: item.payment_currency })}</span></div><div><span>Payment: {item.payment_status.replaceAll("_", " ")}</span><span>Fulfilment: {item.fulfilment_status.replaceAll("_", " ")}</span></div><div><span>Order: {item.order_status.replaceAll("_", " ")}</span><span>{item.last4 ? `Card ending ${item.last4}` : "Card not yet available"}</span></div><div className="customer-order-actions"><button type="button" onClick={() => void refreshOrderStatus(item.id)}>View status</button>{item.payment_status !== "successful" && item.latest_payment_url && <a className="resume-payment" href={item.latest_payment_url}>Resume payment</a>}{item.payment_status !== "successful" && (item.latest_payment_status === "failed" || !item.latest_payment_status) && <button type="button" onClick={() => { setOrderId(item.id); if (item.latest_payment_provider === "btcpay" || item.latest_payment_provider === "flutterwave") setPaymentMethod(item.latest_payment_provider); if (item.card_amount_usd && !catalog?.denominations.some((d) => d.amountUsd === Number(item.card_amount_usd))) setCustomAmount(String(item.card_amount_usd)); else { setSelectedAmount(Number(item.card_amount_usd)); setCustomAmount(""); } window.scrollTo({ top: 0, behavior: "smooth" }); }}>Retry checkout</button>}{item.payment_status !== "successful" && item.latest_payment_status === "pending" && !item.latest_payment_url && <span className="payment-reconciling">Payment attempt is being reconciled. Check status before retrying.</span>}</div></article>)}
        </section>}
        <footer className="site-footer"><span>© {new Date().getFullYear()} Cards by Raaduns</span><span>Virtual cards, made simple.</span></footer>
      </>}
    </main>
  );
}

export default function App() {
  return window.location.pathname.startsWith("/admin") ? <AdminApp /> : <Storefront />;
}