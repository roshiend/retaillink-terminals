# Retaillink Billing SDK

The recurring-billing client lives in the same `packages/sdk-js` package and is compiled as `dist/billing.js`.

```ts
import { RetaillinkBilling } from '@retaillink/sdk/dist/billing.js';

const billing = new RetaillinkBilling({
  apiKey: process.env.RETAILLINK_SECRET_KEY!,
});
```

## Create a subscription

```ts
const subscription = await billing.subscriptions.create({
  customer: 'customer_id',
  amount: 250000,
  currency: 'LKR',
  interval: 'month',
  interval_count: 1,
  description: 'Monthly membership',
});

console.log(subscription.latest_invoice.checkout_url);
```

The checkout URL is a sandbox hosted payment page. Paying that invoice does not store or create a reusable real-card credential.

## Simulate the next cycle

```ts
await billing.subscriptions.runCycle(subscription.id);
```

This is a sandbox scheduler simulation and generates the next invoice immediately.

## Cancel

```ts
await billing.subscriptions.cancel(subscription.id, {
  at_period_end: true,
});
```

Immediate cancellation:

```ts
await billing.subscriptions.cancel(subscription.id, {
  at_period_end: false,
});
```

## Invoices

```ts
const invoices = await billing.invoices.list();
const invoice = await billing.invoices.retrieve('invoice_id');
await billing.invoices.void('invoice_id');
```

Only an unpaid open invoice can be voided. Voiding it also makes its hosted checkout non-payable.
