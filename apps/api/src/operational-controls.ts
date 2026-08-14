import type { FastifyInstance } from 'fastify';
import { registerAccountSecurity } from './account-security.js';
import { registerBillingControls } from './billing-controls.js';
import { registerPersistentIdempotency } from './idempotency.js';
import { registerPaymentIntentControl } from './payment-intent-control.js';
import { registerRefundConcurrency } from './refund-concurrency.js';
import { registerSandboxCardGuard } from './sandbox-card-guard.js';
import { registerWebhookControls } from './webhook-controls.js';
import { registerWebhookRetry } from './webhook-retry.js';

export function registerOperationalControls(app: FastifyInstance) {
  registerPersistentIdempotency(app);
  registerSandboxCardGuard(app);
  registerPaymentIntentControl(app);
  registerRefundConcurrency(app);
  registerBillingControls(app);
  registerAccountSecurity(app);
  registerWebhookControls(app);
  registerWebhookRetry(app);
}
