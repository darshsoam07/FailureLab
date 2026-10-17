import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

class DashboardErrorBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <main className="min-h-screen bg-ink p-8 text-slate-100"><h1 className="text-xl font-semibold">The dashboard could not render.</h1><p className="my-4 text-slate-400">Reload to reconnect. Existing experiments remain managed by the controller watchdog.</p><button className="rounded bg-mint px-4 py-2 text-ink" onClick={() => window.location.reload()}>Reload dashboard</button></main>;
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(<React.StrictMode><DashboardErrorBoundary><App /></DashboardErrorBoundary></React.StrictMode>);
