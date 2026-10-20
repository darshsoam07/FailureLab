import { AppErrorBoundary } from './components/common/AppErrorBoundary.jsx';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { AuthenticatedApp } from './components/auth/AuthenticatedApp.jsx';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')).render(<React.StrictMode><AppErrorBoundary><AuthenticatedApp /></AppErrorBoundary></React.StrictMode>);
