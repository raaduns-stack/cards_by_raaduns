import { useCallback, useEffect, useState, type FormEvent } from "react";

type Identity = { id: number; email: string; displayName: string; role: "admin" | "operations" | "support" };
type Order = {
  id: string; order_number: string; customer_email: string; currency: string; amount: number;
  order_status: string; payment_status: string; fulfilment_status: string; created_at: string;
  issuance_status: string | null; last4: string | null;
};
type ProviderStatus = { provider: "flutterwave" | "kripicard" | "smtp"; configured: boolean; configuredFields: string[]; environment: string; verificationStatus: string; lastVerifiedAt: string | null };
type Pricing = {
  settings: { currency: string; custom_enabled: number; custom_min: number | null; custom_max: number | null; custom_step: number | null } | null;
  denominations: Array<{ amount: number; is_enabled: number }>;
};

async function request<T>(path: string, csrf: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  if (csrf && init.method && init.method !== "GET") headers.set("x-csrf-token", csrf);
  const response = await fetch(path, { ...init, headers, credentials: "include" });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Request failed.");
  return payload;
}

export default function AdminApp() {
  const [user, setUser] = useState<Identity | null>(null);
  const [csrf, setCsrf] = useState("");
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("overview");
  const [overview, setOverview] = useState<{ metrics: Record<string, number>; recentOrders: Order[] } | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [selectedOrder, setSelectedOrder] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [customEnabled, setCustomEnabled] = useState(false);
  const [customMin, setCustomMin] = useState("20");
  const [customMax, setCustomMax] = useState("200");
  const [customStep, setCustomStep] = useState("10");
  const [denominations, setDenominations] = useState<Array<{ amount: number; enabled: boolean }>>([]);
  const [auditEvents, setAuditEvents] = useState<Array<Record<string, unknown>>>([]);
  const [providerStatuses, setProviderStatuses] = useState<ProviderStatus[]>([]);
  const [providerForms, setProviderForms] = useState<Record<string, string>>({ environment: "test", kripicardBin: "539502", smtpPort: "587" });

  const loadSession = useCallback(async () => {
    try {
      const result = await request<{ user: Identity; csrfToken: string }>("/api/admin/auth/session", "");
      setUser(result.user); setCsrf(result.csrfToken ?? "");
    } catch { setUser(null); }
    finally { setChecking(false); }
  }, []);

  useEffect(() => { void loadSession(); }, [loadSession]);

  const loadOverview = useCallback(async () => {
    const data = await request<{ metrics: Record<string, number>; recentOrders: Order[] }>("/api/admin/overview", csrf);
    setOverview(data);
  }, [csrf]);
  const loadOrders = useCallback(async () => {
    const query = new URLSearchParams({ search, status });
    const data = await request<{ orders: Order[] }>(`/api/admin/orders?${query}`, csrf);
    setOrders(data.orders);
  }, [csrf, search, status]);
  const loadPricing = useCallback(async () => {
    const data = await request<Pricing>("/api/admin/pricing", csrf);
    setPricing(data);
    setCustomEnabled(Boolean(data.settings?.custom_enabled));
    setCustomMin(String(data.settings?.custom_min ?? 20));
    setCustomMax(String(data.settings?.custom_max ?? 200));
    setCustomStep(String(data.settings?.custom_step ?? 10));
    setDenominations(data.denominations.map((item) => ({ amount: Number(item.amount), enabled: Boolean(item.is_enabled) })));
  }, [csrf]);
  const loadProviders = useCallback(async () => {
    const data = await request<{ providers: ProviderStatus[] }>("/api/admin/providers", csrf);
    setProviderStatuses(data.providers);
  }, [csrf]);
  const loadAudit = useCallback(async () => {
    const data = await request<{ events: Array<Record<string, unknown>> }>("/api/admin/audit", csrf);
    setAuditEvents(data.events);
  }, [csrf]);

  useEffect(() => {
    if (!user) return;
    setError("");
    const task = tab === "overview" ? loadOverview : tab === "orders" ? loadOrders : tab === "pricing" ? loadPricing : tab === "providers" ? loadProviders : loadAudit;
    void task().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to load admin data."));
  }, [user, tab, loadOverview, loadOrders, loadPricing, loadProviders, loadAudit]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = await request<{ user: Identity; csrfToken: string }>("/api/admin/auth/login", "", {
        method: "POST", body: JSON.stringify({ email, password }),
      });
      setUser(result.user); setCsrf(result.csrfToken); setPassword(""); setTab("overview");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Sign-in failed."); }
    finally { setBusy(false); }
  }

  async function signOut() {
    setBusy(true);
    try { await request("/api/admin/auth/logout", csrf, { method: "POST", body: "{}" }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Sign-out failed."); }
    finally { setUser(null); setCsrf(""); setBusy(false); }
  }

  async function markManualReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedOrder) return;
    setBusy(true); setError("");
    try {
      await request(`/api/admin/orders/${selectedOrder}/manual-review`, csrf, {
        method: "POST", body: JSON.stringify({ note: reviewNote }),
      });
      setSelectedOrder(""); setReviewNote(""); await loadOrders();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to update order."); }
    finally { setBusy(false); }
  }

  async function savePricing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await request("/api/admin/pricing", csrf, {
        method: "PUT", body: JSON.stringify({
          customEnabled, customMin: customEnabled ? Number(customMin) : null,
          customMax: customEnabled ? Number(customMax) : null, customStep: customEnabled ? Number(customStep) : null,
          denominations,
        }),
      });
      await loadPricing();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save pricing."); }
    finally { setBusy(false); }
  }

  async function saveProvider(provider: "flutterwave" | "kripicard" | "smtp") {
    setBusy(true); setError("");
    const values = provider === "flutterwave"
      ? { secretKey: providerForms.fwSecretKey, webhookSecret: providerForms.fwWebhookSecret, environment: providerForms.environment }
      : provider === "kripicard"
        ? { apiKey: providerForms.kripicardApiKey, bin: providerForms.kripicardBin }
        : { host: providerForms.smtpHost, port: providerForms.smtpPort, user: providerForms.smtpUser, password: providerForms.smtpPassword, from: providerForms.smtpFrom };
    try {
      await request("/api/admin/providers/" + provider, csrf, { method: "PUT", body: JSON.stringify(values) });
      setProviderForms((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.toLowerCase().includes(provider === "flutterwave" ? "fwsecret" : provider === "kripicard" ? "kripicardapikey" : "smtppassword"))));
      await loadProviders();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save provider settings."); }
    finally { setBusy(false); }
  }
  async function verifyProvider(provider: "flutterwave" | "kripicard" | "smtp") {
    setBusy(true); setError("");
    try {
      await request("/api/admin/providers/" + provider + "/verify", csrf, { method: "POST", body: "{}" });
      await loadProviders();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Provider verification failed."); await loadProviders().catch(() => undefined); }
    finally { setBusy(false); }
  }
  function providerField(key: string, label: string, type = "text", placeholder = "Leave blank to keep current value") {
    return <label className="provider-field">{label}<input type={type} autoComplete="off" value={providerForms[key] ?? ""} placeholder={placeholder} onChange={(event) => setProviderForms((current) => ({ ...current, [key]: event.target.value }))} /></label>;
  }

  if (checking) return <main className="admin-shell"><p>Checking administrator session…</p></main>;
  if (!user) return (
    <main className="admin-shell admin-login">
      <a className="admin-brand" href="/">CARDS BY RAADUNS <span>/ ADMIN</span></a>
      <section className="admin-panel login-panel">
        <p className="admin-eyebrow">SECURE ADMINISTRATION</p><h1>Sign in</h1>
        <p className="admin-muted">Access is restricted to authorised staff accounts.</p>
        <form onSubmit={signIn}>
          <label>Email address<input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <button className="admin-primary" disabled={busy}>{busy ? "Signing in…" : "Sign in securely"}</button>
        </form>
        {error && <p className="admin-error" role="alert">{error}</p>}
        <a className="admin-back" href="/">← Return to storefront</a>
      </section>
    </main>
  );

  return (
    <main className="admin-shell">
      <header className="admin-topbar">
        <a className="admin-brand" href="/">CARDS BY RAADUNS <span>/ ADMIN</span></a>
        <div className="admin-user"><span>{user.displayName} · {user.role}</span><button onClick={() => void signOut()} disabled={busy}>Sign out</button></div>
      </header>
      <div className="admin-layout">
        <aside className="admin-sidebar">
          <p className="admin-eyebrow">WORKSPACE</p>
          {["overview","orders","pricing",...(user.role === "admin" ? ["providers","audit"] : [])].map((item) =>
            <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item[0]?.toUpperCase()}{item.slice(1)}</button>)}
        </aside>
        <section className="admin-content">
          <div className="admin-heading"><div><p className="admin-eyebrow">OPERATIONS CONSOLE</p><h1>{tab === "overview" ? "Dashboard" : tab[0]?.toUpperCase() + tab.slice(1)}</h1></div><span className="admin-role">{user.role}</span></div>
          {error && <p className="admin-error" role="alert">{error}</p>}
          {tab === "overview" && overview && <>
            <div className="admin-metrics">
              {[
                ["Total orders", overview.metrics.total_orders], ["Awaiting payment", overview.metrics.awaiting_payment],
                ["Payment verified", overview.metrics.paid], ["Manual review", overview.metrics.manual_review],
                ["Fulfilled", overview.metrics.fulfilled],
              ].map(([label, value]) => <article className="admin-metric" key={String(label)}><span>{label}</span><strong>{Number(value ?? 0).toLocaleString()}</strong></article>)}
            </div>
            <h2>Recent orders</h2><OrderTable orders={overview.recentOrders} />
          </>}
          {tab === "orders" && <>
            <div className="admin-filters">
              <input aria-label="Search orders" placeholder="Search order, email or ID" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void loadOrders(); }} />
              <select aria-label="Filter by status" value={status} onChange={(event) => setStatus(event.target.value)}>
                {["all","pending_payment","paid","fulfilment_pending","fulfilled","cancelled","failed","manual_review"].map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}
              </select>
              <button onClick={() => void loadOrders()}>Apply filters</button>
            </div>
            <OrderTable orders={orders} action={(order) => setSelectedOrder(order.id)} canReview={user.role !== "support"} />
            {selectedOrder && <form className="admin-panel review-form" onSubmit={markManualReview}>
              <h3>Move order to manual review</h3><p className="admin-muted">Only payment-verified orders can be moved. This does not retry card issuance.</p>
              <textarea required minLength={5} maxLength={1000} value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="Record the operational reason…" />
              <div><button className="admin-primary" disabled={busy}>Confirm review</button><button type="button" onClick={() => setSelectedOrder("")}>Cancel</button></div>
            </form>}
          </>}
          {tab === "pricing" && pricing && <>
            {user.role === "admin" ? <form className="admin-panel pricing-form" onSubmit={savePricing}>
              <p className="admin-muted">Currency: USD. The approved fixed denominations cannot be changed, only enabled or disabled.</p>
              <h2>Fixed denominations</h2>
              <div className="admin-denominations">{denominations.map((item, index) => <label key={item.amount}><input type="checkbox" checked={item.enabled} onChange={(event) => setDenominations((current) => current.map((d, i) => i === index ? { ...d, enabled: event.target.checked } : d))} /> <strong>${item.amount}</strong></label>)}</div>
              <h2>Custom amount</h2>
              <label className="admin-toggle"><input type="checkbox" checked={customEnabled} onChange={(event) => setCustomEnabled(event.target.checked)} /> Enable custom amounts</label>
              {customEnabled && <div className="admin-pricing-grid">
                <label>Minimum (USD)<input type="number" min="0.01" step="0.01" value={customMin} onChange={(event) => setCustomMin(event.target.value)} /></label>
                <label>Maximum (USD)<input type="number" min="0.01" step="0.01" value={customMax} onChange={(event) => setCustomMax(event.target.value)} /></label>
                <label>Increment (USD)<input type="number" min="0.01" step="0.01" value={customStep} onChange={(event) => setCustomStep(event.target.value)} /></label>
              </div>}
              <button className="admin-primary" disabled={busy}>{busy ? "Saving…" : "Save pricing configuration"}</button>
            </form> : <p className="admin-muted">Pricing configuration is read-only for your role. Contact an administrator to make changes.</p>}
          </>}
          {tab === "providers" && user.role === "admin" && <div className="provider-settings">
            <p className="admin-muted">Credentials are encrypted at rest. Existing secrets are never returned to this page; leave secret fields blank to retain the current value. Configure APP_ENCRYPTION_KEY on the server before saving.</p>
            {(["flutterwave", "kripicard", "smtp"] as const).map((provider) => {
              const status = providerStatuses.find((item) => item.provider === provider);
              return <section className="admin-panel provider-panel" key={provider}>
                <div className="provider-heading"><div><h2>{provider === "flutterwave" ? "Flutterwave · Payments" : provider === "kripicard" ? "Kripicard · Card issuance" : "SMTP · Email delivery"} </h2><p className="admin-muted">{status?.configured ? "Configured" : "Not configured"} · Verification: {status?.verificationStatus ?? "not tested"}</p></div><span className="admin-role">{status?.environment ?? "production"}</span></div>
                {provider === "flutterwave" && <><label className="provider-field">Environment<select value={providerForms.environment ?? "test"} onChange={(event) => setProviderForms((current) => ({ ...current, environment: event.target.value }))}><option value="test">Test</option><option value="live">Live</option></select></label>{providerField("fwSecretKey", "Secret key", "password")}{providerField("fwWebhookSecret", "Webhook secret hash", "password")}</>}
                {provider === "kripicard" && <>{providerField("kripicardApiKey", "API key", "password")}{providerField("kripicardBin", "BIN", "text", "539502")}</>}
                {provider === "smtp" && <>{providerField("smtpHost", "SMTP host")}{providerField("smtpPort", "SMTP port", "number", "587")}{providerField("smtpUser", "SMTP username")}{providerField("smtpPassword", "SMTP password", "password")}{providerField("smtpFrom", "From address")}</>}
                <div className="provider-actions"><button className="admin-primary" disabled={busy} onClick={() => void saveProvider(provider)}>Save credentials</button><button disabled={busy || !status?.configured} onClick={() => void verifyProvider(provider)}>Verify connection</button></div>
                {provider === "kripicard" && <p className="admin-muted">Kripicard verification is disabled until a documented non-issuing verification endpoint is available. No test card will be created.</p>}
                {status?.lastVerifiedAt && <p className="admin-muted">Last verified: {new Date(status.lastVerifiedAt).toLocaleString()}</p>}
              </section>;
            })}
          </div>}
          {tab === "audit" && <div className="admin-panel admin-audit">
            {auditEvents.map((event, index) => <article key={String(event.id ?? index)}><strong>{String(event.action)}</strong><span>{String(event.email ?? "System")} · {String(event.entity_type)} {String(event.entity_id ?? "")}</span><time>{new Date(String(event.created_at)).toLocaleString()}</time><pre>{JSON.stringify(event.details, null, 2)}</pre></article>)}
            {!auditEvents.length && <p className="admin-muted">No audit events recorded yet.</p>}
          </div>}
        </section>
      </div>
    </main>
  );
}

function OrderTable({ orders, action, canReview = false }: { orders: Order[]; action?: (order: Order) => void; canReview?: boolean }) {
  return <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Order</th><th>Customer</th><th>Amount</th><th>Payment</th><th>Fulfilment</th><th>Created</th>{canReview && <th>Action</th>}</tr></thead>
    <tbody>{orders.map((order) => <tr key={order.id}><td><strong>{order.order_number}</strong><small>{order.order_status.replaceAll("_", " ")}</small></td><td>{order.customer_email}</td><td>{order.currency} {Number(order.amount).toFixed(2)}</td><td>{order.payment_status.replaceAll("_", " ")}</td><td>{order.fulfilment_status.replaceAll("_", " ")}{order.last4 ? <small>•••• {order.last4}</small> : null}</td><td>{new Date(order.created_at).toLocaleDateString()}</td>{canReview && <td>{order.payment_status === "successful" && order.fulfilment_status !== "completed" && action ? <button onClick={() => action(order)}>Review</button> : "—"}</td>}</tr>)}
    {!orders.length && <tr><td colSpan={canReview ? 7 : 6}>No orders found.</td></tr>}</tbody></table></div>;
}