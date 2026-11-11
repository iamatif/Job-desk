const errors = {
  'google-reauth-required': 'Confirm your Jobdesk password to connect Google.',
  'google-link-expired': 'Your connection request expired. Connect Google again to continue.',
  'google-linked-elsewhere': 'This Google account is already connected to another Jobdesk account. Choose a different Google account.',
  'google-invalid-client': 'Google rejected the app credentials. Check the saved web client ID and secret.',
  'google-denied': 'Google sign-in was cancelled. You can try again when ready.',
  'google-email-mismatch': 'Confirm your Jobdesk password before connecting this Google account.',
  'google-failed': 'Google sign-in could not be completed. Please try again.',
};
export const googleErrorMessage = code => errors[code] || '';

export function bindGoogleConnect(button, {api, user}) {
  if (user.googleConnected) { button.remove(); return; }
  button.onclick = event => {
    if (!user.hasPassword) return;
    event.preventDefault();
    document.querySelector('#google-connect-dialog')?.remove();
    const dialog = document.createElement('dialog');
    dialog.id = 'google-connect-dialog';
    dialog.setAttribute('aria-labelledby', 'google-connect-title');
    dialog.innerHTML = `<form><h2 id="google-connect-title">Connect your Google account</h2><p class="muted mt">Confirm your Jobdesk password, then choose the Google account you want to use. Your profile, CV, and saved jobs stay in this workspace.</p><label>Current Jobdesk password<input name="password" type="password" required maxlength="128" autocomplete="current-password"></label><p class="form-error" role="alert" hidden></p><div class="actions"><button type="button" class="button" data-cancel>Cancel</button><button class="button primary" type="submit">Continue to Google ↗</button></div></form>`;
    document.body.append(dialog);
    const form = dialog.querySelector('form');
    dialog.addEventListener('close', () => { form.reset(); dialog.remove(); button.focus(); }, {once: true});
    dialog.querySelector('[data-cancel]').onclick = () => dialog.close();
    form.onsubmit = async event => {
      event.preventDefault();
      const submit = form.querySelector('[type="submit"]'), error = form.querySelector('[role="alert"]');
      submit.disabled = true; error.hidden = true;
      try {
        await api('/api/account/google/connect', 'POST', {password: form.elements.password.value});
        if (!dialog.isConnected || !dialog.open) return;
        form.reset();
        location.assign('/auth/google');
      } catch (failure) {
        if (!dialog.isConnected || !dialog.open) return;
        form.reset(); error.textContent = failure.message; error.hidden = false;
        form.elements.password.focus(); submit.disabled = false;
      }
    };
    dialog.showModal();
  };
}
