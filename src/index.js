import { createApp, startWorker } from './server.js';
import { config } from './config.js';
import { init } from './db.js';
import * as paypal from './paypal.js';

init();
startWorker();
createApp().listen(config.port, '0.0.0.0', () => {
  console.log(`Leash running on http://localhost:${config.port}`);
  console.log(`PayPal: ${paypal.mode()}${paypal.isMock() ? '  (MOCK: add PAYPAL_CLIENT_ID and PAYPAL_SECRET to use the sandbox)' : ''}`);
  console.log(`LLM: ${config.gemini.key ? config.gemini.models.join(' > ') : 'fallback parser (add GEMINI_API_KEY for Gemini)'}`);
});
