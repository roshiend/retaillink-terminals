import type { FastifyInstance } from 'fastify';
import { registerPersistentIdempotency } from './idempotency.js';
import { registerPaymentIntentControl } from './payment-intent-control.js';
import { registerRefundConcurrency } from './refund-concurrency.js';
import { registerWebhookControls } from './webhook-controls.js';
import { registerWebhookRetry } from './webhook-retry.js';

export function registerOperationalControls(app: FastifyInstance) {
  registerPersistentIdempotency(app);
  registerPaymentIntentControl(app);
  registerRefundConcurrency(app);
  registerWebhookControls(app);
  registerWebhookRetry(app);
}
