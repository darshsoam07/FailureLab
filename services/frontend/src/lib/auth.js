export const AUTH_SCREENS = ['SIGNUP', 'LOGIN', 'FORGOT_PASSWORD', 'VERIFY_CODE', 'RESET_PASSWORD'];
export const INITIAL_AUTH_STATE = { screen: 'LOGIN', resetId: null, resetToken: null, notice: '' };

/** Reset credentials stay in memory and cannot be reached by navigation alone. */
export function authReducer(state, event) {
  switch (event.type) {
    case 'NAVIGATE':
      if (!['SIGNUP', 'LOGIN', 'FORGOT_PASSWORD'].includes(event.screen)) return state;
      return { ...INITIAL_AUTH_STATE, screen: event.screen };
    case 'CODE_SENT':
      if (!['FORGOT_PASSWORD', 'VERIFY_CODE'].includes(state.screen) || !event.resetId) return state;
      return { ...state, screen: 'VERIFY_CODE', resetId: event.resetId, resetToken: null, notice: '' };
    case 'VERIFIED':
      if (state.screen !== 'VERIFY_CODE' || !state.resetId || !event.token) return state;
      return { ...state, screen: 'RESET_PASSWORD', resetToken: event.token };
    case 'RESET_DONE':
      if (state.screen !== 'RESET_PASSWORD') return state;
      return { ...INITIAL_AUTH_STATE, notice: 'Password reset successfully. Log in with your new password.' };
    case 'BACK':
      return { ...INITIAL_AUTH_STATE, screen: ['VERIFY_CODE', 'RESET_PASSWORD'].includes(state.screen) ? 'FORGOT_PASSWORD' : 'LOGIN' };
    default: return state;
  }
}

export function maskEmail(email) {
  const [name, domain] = email.split('@');
  return domain ? `....${name.length > 4 ? name.slice(-4) : '*'.repeat(name.length)}@${domain}` : 'your email address';
}

export function otpEdit(digits, index, value) {
  const incoming = value.replace(/\D/g, '').slice(0, 4 - index);
  const next = [...digits];
  if (!incoming) next[index] = '';
  else [...incoming].forEach((digit, offset) => { next[index + offset] = digit; });
  return { digits: next, focus: Math.min(3, index + incoming.length) };
}

export function secondsRemaining(deadline, now = Date.now()) {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}
