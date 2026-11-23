import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './style.css';
import './account.css';
class AppErrorBoundary extends React.Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="signin-main" role="alert">
        <h1>Reload PlayGo</h1>
        <p>A page component failed to load. Reload to get the current version.</p>
        <button className="primary" type="button" onClick={() => window.location.reload()}>Reload PlayGo</button>
      </main>
    );
  }
}

createRoot(document.getElementById('root')).render(<AppErrorBoundary><App /></AppErrorBoundary>);