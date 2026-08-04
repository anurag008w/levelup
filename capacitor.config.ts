import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.anurag.levelup',
  appName: 'LevelUp',
  webDir: 'dist',
  plugins: {
    LocalNotifications: {
      // Android 8+ notification status-bar icon (monochrome lightbulb) —
      // bina iske plugin app icon use karta hai jo status bar me solid dikhta hai.
      smallIcon: 'ic_stat_lightbulb',
      iconColor: '#26A69A',
    },
  },
};

export default config;
