// Sign-in and account: the My places banner, the sign-in sheet, and the account sheet.

import { esc, icon } from '../lib/html.js';

const sheet = (id, body) => `
  <div class="sheet-backdrop" data-action="close-sheet"></div>
  <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="${id}" tabindex="-1">
    <div class="grabber" aria-hidden="true"></div>
    ${body}
  </div>`;

export const signInBanner = `
  <section class="signin-banner">
    <div>
      <p class="signin-title">Keep your places forever</p>
      <p class="muted small">Sign in with your email to save them to your account, on any phone. No password.</p>
    </div>
    <button class="btn primary" data-action="open-signin">Sign in</button>
  </section>`;

const ago = (iso) => {
  if (!iso) return '';
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  return mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

export function syncText(status) {
  return {
    syncing: 'Saving to your account…',
    synced: `Saved to your account${status.at ? ` · ${ago(status.at)}` : ''}`,
    offline: "Offline: changes will save to your account when you're back online",
    error: "Couldn't reach your account. Changes are safe on this phone and will retry.",
  }[status.state] ?? 'Saved to your account';
}

export function syncLine(user, status) {
  if (!user) return 'Saved on this phone only. <button class="link" data-action="open-signin">Sign in</button> to keep them forever.';
  return `${esc(syncText(status))} · <button class="link" data-action="open-account">${esc(user.email)}</button>`;
}

// s: { step: 'email' | 'code', email, busy, error, message }
export function signInSheet(s) {
  const body =
    s.step === 'code'
      ? `<h2 id="si-title">Enter your code</h2>
         <p class="muted">We sent a sign-in code to <b>${esc(s.email)}</b>. It can take a minute to arrive; check spam too.</p>
         <form class="signin-form" data-form="verify-code">
           <label class="field-label" for="signin-code">Code</label>
           <input id="signin-code" class="input code-input" inputmode="numeric" autocomplete="one-time-code" maxlength="8"
                  pattern="[0-9]*" placeholder="123456" value="${esc(s.code ?? '')}" required>
           <button class="btn primary block big" type="submit" ${s.busy ? 'disabled' : ''}>${s.busy ? 'Checking…' : 'Sign in'}</button>
         </form>
         <div class="row-actions">
           <button class="link" data-action="resend-code" ${s.busy ? 'disabled' : ''}>Send a new code</button>
           <button class="link" data-action="change-email">Use a different email</button>
         </div>`
      : `<h2 id="si-title">Keep your places forever</h2>
         <p class="muted">Enter your email and we'll send you a code. No password. Your places on this phone are saved to your account and show up on any phone you sign in on.</p>
         <form class="signin-form" data-form="send-code">
           <label class="field-label" for="signin-email">Email</label>
           <input id="signin-email" class="input" type="email" autocomplete="email" inputmode="email"
                  placeholder="you@example.com" value="${esc(s.email ?? '')}" required>
           <button class="btn primary block big" type="submit" ${s.busy ? 'disabled' : ''}>${s.busy ? 'Sending…' : 'Send code'}</button>
         </form>`;
  return sheet(
    'si-title',
    `${body}
     ${s.message ? `<p class="success" role="status">${esc(s.message)}</p>` : ''}
     ${s.error ? `<p class="error" role="alert">${esc(s.error)}</p>` : ''}
     <button class="btn block" data-action="close-sheet">Not now</button>`,
  );
}

export function accountSheet({ user, status, count, homeScreenTip }) {
  return sheet(
    'ac-title',
    `<h2 id="ac-title">Your account</h2>
     <p class="muted">Signed in as <b>${esc(user.email)}</b>. Your ${count} place${count === 1 ? '' : 's'} ${count === 1 ? 'is' : 'are'} saved to your account and show up on any phone you sign in on.</p>
     <p class="hint">${esc(syncText(status))}</p>
     ${status.state !== 'syncing' ? '<button class="btn block" data-action="sync-now">Sync now</button>' : ''}
     ${homeScreenTip ? '<button class="link" data-action="open-homescreen">Add NYC Poops to your Home Screen</button>' : ''}
     <button class="opt" data-action="open-backup"><span class="opt-icon">${icon.download()}</span><span><b>Export or import a file</b><span class="sub">A copy of your places, or bring in a backup</span></span></button>
     <div class="sheet-actions">
       <button class="btn block" data-action="sign-out">Sign out</button>
       <button class="btn danger block" data-action="delete-account">Delete account</button>
     </div>
     <button class="btn block" data-action="close-sheet">Done</button>`,
  );
}
