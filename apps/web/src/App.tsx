const denominations = [20, 30, 50, 100, 150, 200];

export default function App() {
  return (
    <main className="page">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Cards by Raaduns home">
          <span className="brand-mark">R</span>
          <span>Cards by Raaduns</span>
        </a>
        <nav aria-label="Main navigation">
          <a href="#buy">Buy Card</a>
          <a href="#payment">Payment</a>
          <a href="#my-card">My Card</a>
          <a href="#balance">Check Balance</a>
        </nav>
      </header>

      <section className="hero">
        <p className="eyebrow">VIRTUAL PAYMENT CARDS</p>
        <h1>Get your virtual card with a simple checkout.</h1>
        <p className="intro">
          Choose an available card amount, enter your email, and follow the
          payment instructions. Card availability is confirmed at checkout.
        </p>
        <a className="primary-link" href="#buy">Explore card options</a>
      </section>

      <section className="purchase" id="buy">
        <div>
          <p className="eyebrow">START AN ORDER</p>
          <h2>Choose your card amount</h2>
          <p className="muted">
            Fixed USD amounts are shown below. Custom amount limits are managed
            by the administrator.
          </p>
        </div>
        <div className="amount-grid">
          {denominations.map((amount) => (
            <button className="amount" type="button" key={amount} disabled>
              <span className="currency">USD</span>
              <strong>${amount}</strong>
            </button>
          ))}
        </div>
        <p className="notice">
          Storefront preview only. Ordering, payment, account access, and balance
          checks will be enabled after backend and provider integrations pass
          verification.
        </p>
      </section>

      <footer>
        <span>© {new Date().getFullYear()} Cards by Raaduns</span>
        <span>Secure virtual card services</span>
      </footer>
    </main>
  );
}
