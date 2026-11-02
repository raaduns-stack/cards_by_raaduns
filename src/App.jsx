import React, { useEffect, useMemo, useState } from 'react';

function Card({ network, comingSoon = false }) {
  const mastercard = network === 'Mastercard';
  const dots = String.fromCharCode(8226).repeat(4);
  return <div className={`payment-card ${mastercard ? 'mastercard' : 'visa'} ${comingSoon ? 'muted-card' : ''}`}>
    <div className="card-top"><span className="card-chip"><i /></span><span className="card-type">VIRTUAL</span></div>
    <div className="card-number">{dots} &nbsp; {dots} &nbsp; {dots} &nbsp; 2048</div>
    <div className="card-bottom"><span>RAADUNS</span>{mastercard ? <span className="mc-mark"><i /><i /></span> : <span className="visa-mark">VISA</span>}</div>
    {comingSoon && <span className="coming-soon">COMING SOON</span>}
  </div>;
}

export default function App() {
  const [catalog,setCatalog]=useState(null),[catalogError,setCatalogError]=useState('');
  const [amount,setAmount]=useState(null),[email,setEmail]=useState(''),[code,setCode]=useState('');
  const [codeSent,setCodeSent]=useState(false),[signedIn,setSignedIn]=useState(false),[csrf,setCsrf]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[custom,setCustom]=useState('');
  const [callbackOrder,setCallbackOrder]=useState(null),[callbackError,setCallbackError]=useState('');
  const callbackOrderId=useMemo(()=>window.location.pathname.startsWith('/payment/callback')?new URLSearchParams(window.location.search).get('orderId')||'': '',[]);
  useEffect(()=>{
    if(callbackOrderId){
      fetch(`/api/orders/${encodeURIComponent(callbackOrderId)}`,{credentials:'include'})
        .then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error||'Unable to retrieve payment status.');setCallbackOrder(d)})
        .catch(e=>setCallbackError(e.message||'Unable to retrieve payment status.'));
      return;
    }
    if(window.location.pathname.startsWith('/admin'))return;
    fetch('/api/customer/auth/session',{credentials:'include'}).then(async r=>{if(!r.ok)return;const s=await r.json();setEmail(s.customer?.email||'');setCsrf(s.csrfToken||'');setSignedIn(true)}).catch(()=>{});
    fetch('/api/catalog').then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.message||'Card options are temporarily unavailable.');setCatalog(d)}).catch(e=>setCatalogError(e.message||'Unable to load card options.'));
  },[callbackOrderId]);
  const product=catalog?.products?.find(p=>p.network?.toLowerCase()==='mastercard')||catalog?.products?.[0];
  const denominations=useMemo(()=>catalog?.denominations||[],[catalog]);
  const money=v=>Number(v).toLocaleString('en-US',{maximumFractionDigits:2});
  async function orderAndPay(token){
    const o=await fetch('/api/orders',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json','x-csrf-token':token},body:JSON.stringify({productCode:product.code,amount:Number(amount)})});
    const order=await o.json();if(!o.ok||!order.orderId)throw new Error(order.error||order.message||'Unable to create your order.');
    const p=await fetch('/api/payments/flutterwave/initialize',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json','x-csrf-token':token},body:JSON.stringify({orderId:order.orderId})});
    const payment=await p.json();if(!p.ok||!payment.paymentUrl)throw new Error(payment.error||payment.message||'Unable to initialize payment.');
    window.location.assign(payment.paymentUrl);
  }
  async function submit(e){
    e.preventDefault();setError('');
    if(!product?.code||!amount||!email.trim()){setError('Choose an amount and enter your email address to continue.');return}
    setBusy(true);
    try{
      if(signedIn){await orderAndPay(csrf);return}
      if(!codeSent){
        const r=await fetch('/api/customer/auth/request-code',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email.trim()})});
        const d=await r.json();if(!r.ok)throw new Error(d.error||d.message||'Unable to send your sign-in code.');setCodeSent(true);
      }else{
        const r=await fetch('/api/customer/auth/verify-code',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email.trim(),code:code.trim()})});
        const d=await r.json();if(!r.ok||!d.csrfToken)throw new Error(d.error||d.message||'Unable to verify your sign-in code.');
        setSignedIn(true);setCsrf(d.csrfToken);await orderAndPay(d.csrfToken);
      }
    }catch(e){setError(e.message||'Something went wrong. Please try again.')}finally{setBusy(false)}
  }
  if(window.location.pathname.startsWith('/admin'))return <iframe className="admin-frame" src="/admin/index.html" title="Cards administration"/>;
  if(callbackOrderId)return <main className="status-page"><div className="status-panel"><a className="brand" href="/"><span className="brand-icon">R</span><span>RAADUNS / CARDS</span></a><h1>Payment status</h1>{callbackError?<p className="notice error">{callbackError}</p>:!callbackOrder?<p className="notice">Checking your payment...</p>:<><p>Order reference: {callbackOrder.orderId||callbackOrder.id||callbackOrderId}</p><p>Payment: {callbackOrder.paymentStatus||callbackOrder.payment_status||callbackOrder.status||'Pending verification'}</p><p>Card fulfilment begins after payment is verified.</p></>}<a className="back-link" href="/">Return to Cards by Raaduns</a></div></main>;
  return <main className="page-shell">
    <header className="site-header"><a className="brand" href="/" aria-label="Cards by Raaduns home"><span className="brand-icon">R</span><span>RAADUNS<span className="brand-light"> / CARDS</span></span></a><span className="secure-note"><span className="secure-dot"/>Secure checkout</span></header>
    <section className="hero"><div className="hero-copy"><h1>Get Your Virtual Card Instantly</h1><p className="kyc-line">NO KYC REQUIRED</p></div><div className="cards-stage" aria-label="Virtual Mastercard and Visa card illustrations"><div className="card-wrap mastercard-wrap"><Card network="Mastercard"/></div><div className="card-wrap visa-wrap"><Card network="Visa" comingSoon/></div></div></section>
    <section className="purchase-panel" aria-labelledby="amount-heading"><div className="section-heading"><h2 id="amount-heading">Choose your card amount</h2><p>Select a USD card value</p></div>
      {catalogError?<p className="notice error">{catalogError}</p>:!catalog?<p className="notice">Loading available card amounts...</p>:<>
        <div className="denomination-grid">{denominations.map(d=><button type="button" key={d.amountUsd} className={`denomination ${Number(amount)===Number(d.amountUsd)?'selected':''}`} onClick={()=>{setAmount(d.amountUsd);setError('')}}><span className="usd-amount">${money(d.amountUsd)}</span><span className="local-price">NGN {money(d.priceNgn)}</span></button>)}</div>
        {catalog.customAmount?.enabled&&<div className="custom-row"><label htmlFor="custom-amount">Custom amount (USD)</label><input id="custom-amount" type="number" min={catalog.customAmount.min} max={catalog.customAmount.max} step={catalog.customAmount.step||1} value={custom} onChange={e=>{setCustom(e.target.value);setAmount(e.target.value)}} placeholder="Enter amount"/></div>}
        <form className="order-form" onSubmit={submit}><label htmlFor="email">Email address</label><div className="form-row"><input id="email" type="email" autoComplete="email" required placeholder="you@example.com" value={email} onChange={e=>{setEmail(e.target.value);setCodeSent(false);setCode('')}}/><button className="continue-button" type="submit" disabled={busy||!amount||!email.trim()}>{busy?'Processing...':signedIn?'Continue to payment':codeSent?'Verify code & continue':'Continue'}<span aria-hidden="true">&rarr;</span></button></div>
          {codeSent&&!signedIn&&<div className="code-step"><label htmlFor="email-code">Enter the sign-in code sent to your email</label><input id="email-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={e=>setCode(e.target.value)} placeholder="Enter code" required/></div>}
          {error&&<p className="notice error" role="alert">{error}</p>}
        </form>
      </>}
      <p className="fine-print">Payments are collected in {catalog?.paymentCurrency||'NGN'}. Card value is issued in {catalog?.cardCurrency||'USD'}. Card issuance begins after payment is verified.</p>
    </section><footer className="site-footer"><span>© {new Date().getFullYear()} Cards by Raaduns</span><span>Virtual cards, made simple.</span></footer>
  </main>;
}
