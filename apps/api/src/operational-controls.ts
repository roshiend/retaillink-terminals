import type { FastifyInstance } from 'fastify';
import { registerPaymentIntentControl } from './payment-intent-control.js';
import { registerRefundConcurrency } from './refund-concurrency.js';
import { registerWebhookRetry } from './webhook-retry.js';

export function registerOperationalControls(app: FastifyInstance) {
  registerPaymentIntentControl(app);
  registerRefundConcurrency(app);
  registerWebhookRetry(app);
}
