// What kind of device and mode the app is running in.

export const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

// iPads report themselves as Macs; a touch screen gives them away.
export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const isAndroid = () => /Android/.test(navigator.userAgent);

// 'ios' | 'android' | null (desktop: no Home Screen prompt)
export const mobilePlatform = () => (isAndroid() ? 'android' : isIOS() ? 'ios' : null);

// Safari itself, not Chrome/Firefox/Edge/Opera on iPhone (they have their own location settings).
export const isIOSSafari = () => isIOS() && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(navigator.userAgent);

// Steps to turn location back on once it's blocked; the browser never asks again by itself.
// Apple renames the Safari address-bar button between versions ("aA", "⋯"), so name both.
export function locationHelp({ platform, standalone, safari }) {
  const system = 'Settings → Privacy & Security → Location Services → Safari Websites → While Using the App';
  if (platform === 'ios' && standalone) {
    return { steps: [`On your iPhone, open ${system}.`, 'Come back here and reload.'] };
  }
  if (platform === 'ios' && safari) {
    return {
      steps: [
        'Tap the page menu in the address bar (“aA” or “⋯”), then Website Settings.',
        'Set Location to Allow, then reload.',
      ],
      also: `Still blocked? Check ${system}.`,
    };
  }
  return { steps: ["Allow location for this site in your browser's settings, then reload."] };
}
