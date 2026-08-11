import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import './index.css'
import App from './App.tsx'
import RootErrorBoundary from './components/RootErrorBoundary.tsx'
import ScreenSkeleton from './components/ScreenSkeleton.tsx'
import { persistentStoreReady } from './infra/storage/local-storage'
import { container } from './di/container'

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

const root = createRoot(document.getElementById('root')!)

// Boot gate (N1): PersistentKeyValueStore hydrates its cache ASYNCHRONOUSLY at
// module load. Rendering the app before that finishes would let the very first
// store.get() — useAppState's useState initializer — hit CachedStateStore, which
// loads the repository exactly once and caches it forever. The load would see
// an empty cache and cache an EMPTY state: the user's progress vanishes from
// the UI, and the next save silently overwrites the real data in localStorage.
// So: show a skeleton, await hydration, re-read storage into the store (repairs
// any pre-init read), then mount the app.
root.render(
  <StrictMode>
    <div className="min-h-screen bg-bg text-text">
      <ScreenSkeleton />
    </div>
  </StrictMode>,
)

void persistentStoreReady.then(() => {
  container.store.reload()
  root.render(
    <StrictMode>
      <RootErrorBoundary>
        <App />
      </RootErrorBoundary>
    </StrictMode>,
  )
})
