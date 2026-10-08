// What kind of device and mode the app is running in.

export const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

// iPads report themselves as Macs; a touch screen gives them away.
export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const isAndroid = () => /Android/.test(navigator.userAgent);

// 'ios' | 'android' | null (desktop: no Home Screen prompt)
export const mobilePlatform = () => (isAndroid() ? 'android' : isIOS() ? 'ios' : null);
