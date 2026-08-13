# Sandbox recurring billing

Retaillink Terminals recurring billing is intentionally designed for **sandbox development only**.

It does not store or reuse a real card number, CVC, network token, mandate or acquirer credential.

## Model

```text
Customer
  ↓
Subscription
  ↓
Invoice
  ↓
Payment Intent
  ↓
Hosted Checkout
  ↓
Sandbox Payment
```

Each invoice receives its own Payment Intent and hosted checkout URL.

A successful hosted checkout automatically marks the related invoice `paid`.

## Create a subscription

```http
POST /v1/subscriptions
Authorization: Bearer sk_test_...
Content-Type: application/json
```

```json
{
  "customer": "customer_id",
  "amount": 250000,
  "currency": "LKR",
  "interval": "month",
  "interval_count": 1,
  "description": "Monthly membership"
}
```

Supported intervals:

- `day`
- `week`
- `month`
- `year`

The response includes `latest_invoice.checkout_url`.

## Invoice collection

Open the invoice's `checkout_url` and use a sandbox card.

The invoice begins as:

```text
open
```

After successful sandbox checkout it becomes:

```text
paid
```

No future automatic card charge is implied by a paid invoice.

## Simulate the next cycle

```http
POST /v1/subscriptions/{id}/run_cycle
Authorization: Bearer sk_test_...
```

This is a **test-only scheduler simulation**. It immediately advances the billing period and creates the next invoice.

It does not wait for wall-clock time and it does not perform an off-session card charge.

## Cancel a subscription

Cancel at the end of the current period:

```http
POST /v1/subscriptions/{id}/cancel
Authorization: Bearer sk_test_...
Content-Type: application/json
```

```json
{
  "at_period_end": true
}
```

The next `run_cycle` call finalises the cancellation instead of creating another invoice.

Cancel immediately:

```json
{
  "at_period_end": false
}
```

## Void an invoice

```http
POST /v1/invoices/{id}/void
Authorization: Bearer sk_test_...
```

Only an unpaid open invoice can be voided.

Voiding the invoice makes its related hosted checkout non-payable.

## Risk rules

Recurring invoice generation passes through the same sandbox risk-rule evaluator used for Payment Intents.

- `BLOCK` prevents subscription invoice generation.
- `REVIEW` records the decision but allows the sandbox invoice to continue.

## Production boundary

Real recurring payments would require a production-grade mandate/tokenisation design agreed with the acquiring bank or processor. Do not adapt this sandbox by storing PAN/CVC values or by inventing reusable card credentials.
