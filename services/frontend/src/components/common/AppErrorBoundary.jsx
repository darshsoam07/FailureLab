import { Component } from 'react';

export class AppErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main id="main" className="min-h-screen bg-[#0B1020] p-8 text-[#dee1f9]">
      <h1 className="text-xl font-semibold">Something went wrong displaying FailureLab.</h1>
      <p className="my-4 text-[#9aa9ac]">Reload to reconnect. Existing experiments remain managed by the controller watchdog.</p>
      <button type="button" className="rounded bg-[#00e5ff] px-4 py-3 text-[#0B1020] font-semibold" onClick={() => window.location.reload()}>Reload dashboard</button>
    </main>;
  }
}
