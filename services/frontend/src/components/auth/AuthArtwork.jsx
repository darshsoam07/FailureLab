export function AuthArtwork() {
  return (
    <aside className="auth-art" aria-label="About FailureLab">
      <strong className="lab-wordmark">FailureLab</strong>
      <div className="lab-route" aria-label="Order service pipeline">
        {['Order API', 'Toxiproxy', 'Inventory'].map(service => (
          <div className="lab-station" key={service}><i aria-hidden="true" />{service}</div>
        ))}
      </div>
      <p>Run a fault experiment.<br />Trace its impact.</p>
    </aside>
  );
}
