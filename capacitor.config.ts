import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.anurag.levelup',
  appName: 'LevelUp',
  webDir: 'dist',
  // WebView ka background app ke dark theme se match karo (#060506).
  // Default white hai — isliye splash ke baad ek white page flash hota tha,
  // aur Android 15+ edge-to-edge mein status bar transparent hai toh uske
  // peeche bhi yahi white background dikhta tha (white bar).
  backgroundColor: '#060506',
  plugins: {
    CapacitorHttp: {
      // Native HTTP transport (OkHttp) — WebView fetch GitHub release-asset
      // redirects (release-assets.githubusercontent.com) pe CORS se block hota
      // hai ("Failed to fetch"); native request se APK download chalta hai.
      enabled: true,
    },
    LocalNotifications: {
      // Android 8+ notification status-bar icon (monochrome lightbulb) —
      // bina iske plugin app icon use karta hai jo status bar me solid dikhta hai.
      smallIcon: 'ic_stat_lightbulb',
      iconColor: '#26A69A',
    },
  },
};

export default config;
