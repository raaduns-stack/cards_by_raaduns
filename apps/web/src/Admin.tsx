import { useCallback, useEffect, useState, type FormEvent } from "react";
import ProvidersPage, { type ProviderName, type ProviderStatus } from "./pages/admin/ProvidersPage.js";
import DashboardPage from "./pages/admin/DashboardPage.js";
import OrdersPage from "./pages/admin/OrdersPage.js";
import PricingPage from "./pages/admin/PricingPage.js";
import AuditPage from "./pages/admin/AuditPage.js";
import FulfilmentPage, { type FulfilmentItem } from "./pages/admin/FulfilmentPage.js";
import OrderTable, { type AdminOrder } from "./pages/admin/OrderTable.js";


type Identity = { id: number; email: string; displayName: string; role: "admin" | "operations" | "support" };
type Order = AdminOrder;
type Pricing = {
  settings: { currency: string; exchange_rate_ngn_per_usd: number; issuance_fee_usd: number; gross_profit_ngn: number; custom_enabled: number; custom_min: number | null; custom_max: number | null; custom_step: number | null } | null;
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
  const [tab, setTab] = useState(() => resolveAdminRoute(window.location.pathname));
  function navigateToTab(next: string) {
    const target = next === "overview" ? "/admin" : "/admin/" + next;
    if (window.location.pathname !== target) window.history.pushState({}, "", target);
    setTab(next);
  }
  useEffect(() => {
    const syncRoute = () => setTab(resolveAdminRoute(window.location.pathname));
    window.addEventListener("popstate", syncRoute);
    return () => window.removeEventListener("popstate", syncRoute);
  }, []);
  const [overview, setOverview] = useState<{ metrics: Record<string, number>; recentOrders: Order[] } | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [selectedOrder, setSelectedOrder] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [exchangeRate, setExchangeRate] = useState("1430");
  const [issuanceFee, setIssuanceFee] = useState("7");
  const [grossProfit, setGrossProfit] = useState("10000");
  const [customEnabled, setCustomEnabled] = useState(false);
  const [customMin, setCustomMin] = useState("20");
  const [customMax, setCustomMax] = useState("200");
  const [customStep, setCustomStep] = useState("10");
  const [denominations, setDenominations] = useState<Array<{ amount: number; enabled: boolean }>>([]);
  const [auditEvents, setAuditEvents] = useState<Array<Record<string, unknown>>>([]);
  const [fulfilmentItems, setFulfilmentItems] = useState<FulfilmentItem[]>([]);
  const [providerStatuses, setProviderStatuses] = useState<ProviderStatus[]>([]);
  const [providerNotice, setProviderNotice] = useState("");
  const [providerForms, setProviderForms] = useState<Record<string, string>>({ environment: "test", kripicardBin: "539502", smtpPort: "587", btcpayServerUrl: "https://btcpay.scrapee.uk", btcpayEnabled: "false", btcpayBtcEnabled: "true", btcpayLtcEnabled: "true" });

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
    setExchangeRate(String(data.settings?.exchange_rate_ngn_per_usd ?? 1430));
    setIssuanceFee(String(data.settings?.issuance_fee_usd ?? 7));
    setGrossProfit(String(data.settings?.gross_profit_ngn ?? 10000));
    setCustomEnabled(Boolean(data.settings?.custom_enabled));
    setCustomMin(String(data.settings?.custom_min ?? 20));
    setCustomMax(String(data.settings?.custom_max ?? 200));
    setCustomStep(String(data.settings?.custom_step ?? 10));
    setDenominations(data.denominations.map((item) => ({ amount: Number(item.amount), enabled: Boolean(item.is_enabled) })));
  }, [csrf]);
  const loadProviders = useCallback(async () => {
    const data = await request<{ providers: ProviderStatus[] }>("/api/admin/providers", csrf);
    setProviderStatuses(data.providers);
    const btcpay = data.providers.find((item) => item.provider === "btcpay")?.settings;
    if (btcpay) setProviderForms((current) => ({ ...current, btcpayServerUrl: btcpay.serverUrl ?? "https://btcpay.scrapee.uk", btcpayStoreId: btcpay.storeId ?? "", btcpayEnabled: btcpay.enabled ?? "false" }));
  }, [csrf]);
  const loadFulfilment = useCallback(async () => {
    const data = await request<{ items: FulfilmentItem[] }>("/api/admin/fulfilment", csrf);
    setFulfilmentItems(data.items);
  }, [csrf]);
  const loadAudit = useCallback(async () => {
    const data = await request<{ events: Array<Record<string, unknown>> }>("/api/admin/audit", csrf);
    setAuditEvents(data.events);
  }, [csrf]);

  useEffect(() => {
    if (!user) return;
    setError("");
    const task = tab === "overview" ? loadOverview : tab === "orders" ? loadOrders : tab === "pricing" ? loadPricing : tab === "providers" ? loadProviders : tab === "fulfilment" ? loadFulfilment : loadAudit;
    void task().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to load admin data."));
  }, [user, tab, loadOverview, loadOrders, loadPricing, loadProviders, loadFulfilment, loadAudit]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = await request<{ user: Identity; csrfToken: string }>("/api/admin/auth/login", "", {
        method: "POST", body: JSON.stringify({ email, password }),
      });
      setUser(result.user); setCsrf(result.csrfToken); setPassword(""); navigateToTab("overview");
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
          exchangeRateNgnPerUsd: Number(exchangeRate), issuanceFeeUsd: Number(issuanceFee), grossProfitNgn: Number(grossProfit),
          customEnabled, customMin: customEnabled ? Number(customMin) : null,
          customMax: customEnabled ? Number(customMax) : null, customStep: customEnabled ? Number(customStep) : null,
          denominations,
        }),
      });
      await loadPricing();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save pricing."); }
    finally { setBusy(false); }
  }

  async function saveProvider(provider: ProviderName): Promise<boolean> {
    setBusy(true); setError(""); setProviderNotice("");
    const values = provider === "flutterwave"
      ? { publicKey: providerForms.fwPublicKey, secretKey: providerForms.fwSecretKey, webhookSecret: providerForms.fwWebhookSecret, environment: providerForms.environment }
      : provider === "kripicard"
        ? { apiKey: providerForms.kripicardApiKey, bin: providerForms.kripicardBin }
        : provider === "btcpay" ? { serverUrl: providerForms.btcpayServerUrl || "https://btcpay.scrapee.uk", storeId: providerForms.btcpayStoreId, apiKey: providerForms.btcpayApiKey, webhookSecret: providerForms.btcpayWebhookSecret, enabled: providerForms.btcpayEnabled ?? "false" } : { host: providerForms.smtpHost, port: providerForms.smtpPort, user: providerForms.smtpUser, password: providerForms.smtpPassword, from: providerForms.smtpFrom };
    try {
      await request("/api/admin/providers/" + provider, csrf, { method: "PUT", body: JSON.stringify(values) });
      setProviderForms((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !(provider === "flutterwave" ? ["fwpublickey", "fwsecret", "fwwebhooksecret"].some((part) => key.toLowerCase().includes(part)) : provider === "kripicard" ? key.toLowerCase().includes("kripicardapikey") : provider === "btcpay" ? ["btcpayapikey", "btcpaywebhooksecret"].some((part) => key.toLowerCase().includes(part)) : key.toLowerCase().includes("smtppassword")))));
      await loadProviders();
      setProviderNotice(`${provider === "flutterwave" ? "Flutterwave" : provider === "kripicard" ? "Kripicard" : provider === "btcpay" ? "BTCPay" : "SMTP"} settings saved successfully.`);
      return true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save provider settings."); return false; }
    finally { setBusy(false); }
  }
  async function verifyProvider(provider: ProviderName) {
    setBusy(true); setError(""); setProviderNotice("");
    try {
      await request("/api/admin/providers/" + provider + "/verify", csrf, { method: "POST", body: "{}" });
      await loadProviders();
      setProviderNotice(`${provider === "flutterwave" ? "Flutterwave" : provider === "kripicard" ? "Kripicard" : provider === "btcpay" ? "BTCPay" : "SMTP"} connection verified successfully.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Provider verification failed."); await loadProviders().catch(() => undefined); }
    finally { setBusy(false); }
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
          {["overview","orders","fulfilment","pricing",...(user.role === "admin" ? ["providers","audit"] : [])].map((item) =>
            <button key={item} className={tab === item ? "active" : ""} onClick={() => navigateToTab(item)}>{item[0]?.toUpperCase()}{item.slice(1)}</button>)}
        </aside>
        <section className="admin-content">
          <div className="admin-heading"><div><p className="admin-eyebrow">OPERATIONS CONSOLE</p><h1>{tab === "overview" ? "Dashboard" : tab[0]?.toUpperCase() + tab.slice(1)}</h1></div><span className="admin-role">{user.role}</span></div>
          {error && <p className="admin-error" role="alert">{error}</p>}
          {tab === "overview" && <DashboardPage overview={overview} />}
          {tab === "orders" && <OrdersPage orders={orders} search={search} onSearch={setSearch} status={status} onStatus={setStatus} onApply={() => void loadOrders()} onReview={(order) => setSelectedOrder(order.id)} canReview={user.role !== "support"} selectedOrder={selectedOrder} reviewNote={reviewNote} onReviewNote={setReviewNote} onSubmitReview={markManualReview} onCancelReview={() => setSelectedOrder("")} busy={busy} />}
          {tab === "fulfilment" && <FulfilmentPage items={fulfilmentItems} />}
          {tab === "pricing" && <PricingPage pricing={pricing} isAdmin={user.role === "admin"} busy={busy} exchangeRate={exchangeRate} setExchangeRate={setExchangeRate} issuanceFee={issuanceFee} setIssuanceFee={setIssuanceFee} grossProfit={grossProfit} setGrossProfit={setGrossProfit} customEnabled={customEnabled} setCustomEnabled={setCustomEnabled} customMin={customMin} setCustomMin={setCustomMin} customMax={customMax} setCustomMax={setCustomMax} customStep={customStep} setCustomStep={setCustomStep} denominations={denominations} setDenominations={setDenominations} onSubmit={savePricing} />}
          {tab === "providers" && user.role === "admin" && <ProvidersPage statuses={providerStatuses} forms={providerForms} busy={busy} notice={providerNotice} onChange={(key, value) => setProviderForms((current) => ({ ...current, [key]: value }))} onSave={(provider: ProviderName) => saveProvider(provider)} onVerify={(provider: ProviderName) => void verifyProvider(provider)} />}
          {tab === "audit" && <AuditPage events={auditEvents} />}
        </section>
      </div>
    </main>
  );
}

function resolveAdminRoute(pathname: string): string {
  const normalized = pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  const segment = normalized.split("/").pop() ?? "";
  return ["orders", "fulfilment", "pricing", "providers", "audit"].includes(segment) ? segment : "overview";
}

[executed on device: mail.quicrefill.com (657bc0f0-b268-4295-8ef1-fac3aa0eceb5)]