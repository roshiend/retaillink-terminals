import type { FastifyInstance } from 'fastify';
import { registerPaymentIntentControl } from './payment-intent-control.js';
import { registerWebhookRetry } from './webhook-retry.js';

export function registerOperationalControls(app: FastifyInstance) {
  registerPaymentIntentControl(app);
  registerWebhookRetry(app);
}
