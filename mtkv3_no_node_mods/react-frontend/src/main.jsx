import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Clear sessionStorage only in development mode on page load
if (import.meta.env.DEV) {
  sessionStorage.clear();
  console.log("SessionStorage cleared for development mode.");
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)