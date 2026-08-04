import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import './index.css'
import App from './App.tsx'

// Web notifications ka real flow: service worker showNotification use karta hai
// (tab band hone pe bhi kaam karta hai). Native app (Capacitor webview) me SW
// zaroori nahi — wahan LocalNotifications plugin handle karta hai.
if ('serviceWorker' in navigator && !Capacitor.isNativePlatform()) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* SW fail ho to bhi app chalta rahe — Notification constructor fallback hai */
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
