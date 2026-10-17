import 'dotenv/config';

const env = (k, d = '') => (process.env[k] ?? d).toString().trim();
const uniq = (a) => [...new Set(a.filter(Boolean))];

export const config = {
  port: Number(env('PORT', '3000')),
  dataDir: env('DATA_DIR'),
  paypal: {
    clientId: env('PAYPAL_CLIENT_ID'),
    secret: env('PAYPAL_SECRET'),
    webhookId: env('PAYPAL_WEBHOOK_ID'),
    forceMock: env('PAYPAL_MODE') === 'mock',
  },
  gemini: {
    key: env('GEMINI_API_KEY'),
    // Tried in order. If Google retires a model name, the next one is used.
    models: uniq([
      env('GEMINI_MODEL', 'gemini-2.5-flash'),
      ...env('GEMINI_FALLBACK_MODELS', 'gemini-2.5-flash-lite,gemini-flash-latest').split(',').map((s) => s.trim()),
    ]),
  },
  // PayPal SANDBOX personal-account emails that receive the demo payouts.
  vendorEmails: [
    env('VENDOR1_EMAIL', 'northwind@example.test'),
    env('VENDOR2_EMAIL', 'acme@example.test'),
    env('VENDOR3_EMAIL', 'zeta@example.test'),
  ],
};
