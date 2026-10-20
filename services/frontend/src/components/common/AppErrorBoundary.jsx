import { Component } from 'react';

export class AppErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main id="main" className="min-h-screen bg-background p-8 text-foreground">
      <h1 className="text-xl font-semibold">Something went wrong displaying FailureLab.</h1>
      <p className="my-4 text-muted-foreground">Reload to reconnect. Existing experiments remain managed by the controller watchdog.</p>
      <button type="button" className="rounded bg-primary px-4 py-3 text-primary-foreground font-semibold" onClick={() => window.location.reload()}>Reload dashboard</button>
    </main>;
  }
}
