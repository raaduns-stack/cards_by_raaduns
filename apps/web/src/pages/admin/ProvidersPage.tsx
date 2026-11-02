import { useState } from "react";

export type ProviderName = "flutterwave" | "kripicard" | "smtp" | "btcpay";
export type ProviderStatus = {
  provider: ProviderName;
  configured: boolean;
  configuredFields: string[];
  environment: string;
  verificationStatus: string;
  lastVerifiedAt: string | null;
  settings?: { serverUrl?: string; storeId?: string; enabled?: string };
};
type Props = {
  statuses: ProviderStatus[];
  forms: Record<string, string>;
  busy: boolean;
  notice: string;
  onChange: (key: string, value: string) => void;
  onSave: (provider: ProviderName) => Promise<boolean>;
  onVerify: (provider: ProviderName) => void;
};

const providerMeta: Record<ProviderName, { title: string; purpose: string }> = {
  flutterwave: { title: "Flutterwave", purpose: "Payment processing" },
  kripicard: { title: "Kripicard", purpose: "Card issuance" },
  smtp: { title: "SMTP", purpose: "Email delivery" },
  btcpay: { title: "BTCPay", purpose: "Bitcoin and Litecoin checkout" },
};

export default function ProvidersPage({ statuses, forms, busy, notice, onChange, onSave, onVerify }: Props) {
  const [active, setActive] = useState<ProviderName>("flutterwave");
  const [dirtyFields, setDirtyFields] = useState<string[]>([]);
  const selected = statuses.find((item) => item.provider === active);
  const saved = (field: string) => Boolean(selected?.configuredFields.includes(field));
  const verificationLabel = selected?.verificationStatus === "verified" ? "Verified" : selected?.verificationStatus === "failed" ? "Verification failed" : selected?.verificationStatus === "not_tested" || !selected?.verificationStatus ? "Not tested" : selected.verificationStatus.replaceAll("_", " ");
  const field = (key: string, label: string, type = "text", configuredKey = key, placeholder = "Enter value to replace or configure") => (
    <label className="provider-field" key={key}>
      <span className="provider-field-heading">
        <span>{label}</span>
        <span className={dirtyFields.includes(key) ? "field-state is-dirty" : saved(configuredKey) ? "field-state is-saved" : "field-state is-missing"}>
          {dirtyFields.includes(key) ? "Unsaved changes" : saved(configuredKey) ? "Saved" : "Not configured"}
        </span>
      </span>
      <input type={type} autoComplete="off" value={forms[key] ?? ""} placeholder={saved(configuredKey) ? "Saved securely · enter only to replace" : placeholder}
        onChange={(event) => { setDirtyFields((current) => current.includes(key) ? current : [...current, key]); onChange(key, event.target.value); }} />
    </label>
  );
  const select = (key: string, label: string, options: Array<[string, string]>) => (
    <label className="provider-field" key={key}>
      <span className="provider-field-heading"><span>{label}</span><span className={dirtyFields.includes(key) ? "field-state is-dirty" : "field-state is-saved"}>{dirtyFields.includes(key) ? "Unsaved changes" : "Saved setting"}</span></span>
      <select value={forms[key] ?? (options[0]?.[0] ?? "")} onChange={(event) => { setDirtyFields((current) => current.includes(key) ? current : [...current, key]); onChange(key, event.target.value); }}>
        {options.map(([value, text]) => <option value={value} key={value}>{text}</option>)}
      </select>
    </label>
  );

  return (
    <div className="providers-workspace">
      <section className="providers-intro">
        <div><h2>Provider connections</h2><p>Manage payment, card issuance, email and alternative checkout integrations.</p></div>
        <span className="providers-count">{statuses.filter((item) => item.configured).length} of {statuses.length} configured</span>
      </section>
      <div className="providers-layout">
        <nav className="providers-nav" aria-label="Provider settings">
          {(["flutterwave", "kripicard", "smtp", "btcpay"] as ProviderName[]).map((provider) => {
            const item = statuses.find((status) => status.provider === provider);
            return <button type="button" key={provider} className={active === provider ? "selected" : ""} onClick={() => setActive(provider)}>
              <span className="provider-nav-copy"><strong>{providerMeta[provider].title}</strong><small>{providerMeta[provider].purpose}</small></span>
              <span className={item?.configured ? "provider-dot configured" : "provider-dot"} aria-label={item?.configured ? "Configured" : "Not configured"} />
            </button>;
          })}
        </nav>
        <section className="admin-panel provider-editor">
          <header className="provider-editor-heading">
            <div><p className="admin-eyebrow">PROVIDER CONFIGURATION</p><h2>{providerMeta[active].title}</h2><p className="admin-muted">{providerMeta[active].purpose}</p></div>
            <span className={selected?.configured ? "provider-status configured" : "provider-status"}>
              {selected?.configured ? "Configured" : "Not configured"}
            </span>
          </header>
          <div className="provider-verification">
            <div><span>Connection verification</span><strong>{verificationLabel}</strong></div>
            <div><span>Environment</span><strong>{selected?.environment ?? "production"}</strong></div>
            {selected?.lastVerifiedAt && <div><span>Last checked</span><strong>{new Date(selected.lastVerifiedAt).toLocaleString()}</strong></div>}
          </div>
          {active === "flutterwave" && <div className="provider-fields">
            {select("environment", "Environment", [["test", "Test environment"], ["live", "Live environment"]])}
            {field("fwPublicKey", "Public key", "text", "publicKey", "FLWPUBK-…")}
            <p className="provider-help">Public key is stored with provider settings. Hosted checkout authenticates with the Secret Key.</p>
            {field("fwSecretKey", "Secret key", "password", "secretKey")}
            {field("fwWebhookSecret", "Webhook secret hash", "password", "webhookSecret", "Enter the dashboard webhook secret hash")}
          </div>}
          {active === "kripicard" && <div className="provider-fields">
            {field("kripicardApiKey", "API key", "password", "apiKey")}
            {field("kripicardBin", "Card BIN", "text", "bin", "539502")}
            <p className="provider-help">Credential verification is unavailable because no documented non-issuing test endpoint is available. No test card will be created.</p>
          </div>}
          {active === "smtp" && <div className="provider-fields">
            {field("smtpHost", "SMTP host", "text", "host")}
            {field("smtpPort", "SMTP port", "number", "port", "587")}
            {field("smtpUser", "SMTP username", "text", "user")}
            {field("smtpPassword", "SMTP password", "password", "password")}
            {field("smtpFrom", "From address", "email", "from")}
          </div>}
          {active === "btcpay" && <div className="provider-fields">
            {field("btcpayServerUrl", "BTCPay server URL", "url", "serverUrl")}
            {field("btcpayStoreId", "Store ID", "text", "storeId")}
            {field("btcpayApiKey", "API key", "password", "apiKey")}
            {field("btcpayWebhookSecret", "Webhook secret", "password", "webhookSecret")}
            {select("btcpayEnabled", "BTCPay checkout", [["false", "Disabled"], ["true", "Enabled"]])}
            <p className="provider-help">Webhook URL: https://cards.raaduns.com/api/webhooks/btcpay. Subscribe to InvoiceSettled. Enable BTC and/or LTC payment methods in the BTCPay store. The API key requires store access, cancreateinvoice, canviewinvoices and canviewstoresettings permissions. Keep the webhook secret identical to the value configured in BTCPay.</p>
          </div>}
          <div className="provider-editor-actions">
            <button type="button" className="admin-primary" disabled={busy} onClick={async () => { if (await onSave(active)) setDirtyFields((current) => current.filter((key) => !providerFieldKeys[active].includes(key))); }}>{busy ? "Saving…" : "Save changes"}</button>
            <button type="button" disabled={busy || active === "kripicard" || !(active === "flutterwave" ? saved("secretKey") : selected?.configured)} onClick={() => onVerify(active)}>Verify connection</button>
          </div>
          {active === "kripicard" && <p className="provider-help">Verification is intentionally unavailable. Saving credentials does not create a card or activate live issuance.</p>}
          <p className="provider-security-note">Secret values are write-only and never returned to this page. Saved credentials are encrypted on the server. Leave secret fields empty to retain the existing value.</p>
          {notice && <p className="admin-success" role="status" aria-live="polite">{notice}</p>}
        </section>
      </div>
    </div>
  );
}

const providerFieldKeys: Record<ProviderName, string[]> = {
  flutterwave: ["fwPublicKey", "fwSecretKey", "fwWebhookSecret", "environment"],
  kripicard: ["kripicardApiKey", "kripicardBin"],
  smtp: ["smtpHost", "smtpPort", "smtpUser", "smtpPassword", "smtpFrom"],
  btcpay: ["btcpayServerUrl", "btcpayStoreId", "btcpayApiKey", "btcpayWebhookSecret", "btcpayEnabled"],
};