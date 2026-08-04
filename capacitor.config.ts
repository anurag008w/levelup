import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.anurag.levelup',
  appName: 'LevelUp',
  webDir: 'dist',
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
