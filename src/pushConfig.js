// Public Web Push connection values. Keep VAPID private keys and dispatch
// tokens on the push server and in GitHub Actions Secrets, never in this file.
export const PUSH_CONFIG = Object.freeze({
  subscribeUrl: import.meta.env.VITE_PUSH_SUBSCRIBE_URL || '',
  vapidPublicKey: import.meta.env.VITE_PUSH_VAPID_PUBLIC_KEY || '',
});
