const API_URL = (process.env.SANDBOX_API_URL ?? '').replace(/\/$/, '');
const API_KEY = process.env.SANDBOX_API_KEY ?? '';

if (process.env.ALLOW_SANDBOX_SMOKE !== 'true') {
  throw new Error('Set ALLOW_SANDBOX_SMOKE=true to acknowledge this creates synthetic sandbox records.');
}
if (!API_URL.startsWith('https://') && !API_URL.startsWith('http://localhost')) {
  throw new Error('SANDBOX_API_URL must be HTTPS, except localhost development.');
}
if (!API_KEY.startsWith('sk_test_')) {
  throw new Error('SANDBOX_API_KEY must be a sandbox sk_test_ key.');
}

async function request(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${API_KEY}`,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${options.method ?? 'GET'} ${path} -> ${response.status}: ${JSON.stringify(body)}`);
  }
  return { response, body };
}

function checkoutToken(url) {
  const parsed = new URL(url);
  const token = parsed.pathname.split('/').filter(Boolean).at(-1);
  if (!token?.startsWith('ct_test_')) throw new Error(`Unexpected checkout token in ${url}`);
  return token;
}

const runId = `smoke-${Date.now()}-${Math.random().toString(16).slice(2)}`;
console.log(`[smoke] run ${runId}`);

const health = await fetch(`${API_URL}/health`);
if (!health.ok) throw new Error(`/health returned ${health.status}`);
console.log('[smoke] health ok');

const ready = await fetch(`${API_URL}/ready`);
if (!ready.ok) throw new Error(`/ready returned ${ready.status}`);
console.log('[smoke] readiness ok');

const create = await request('/v1/payment_intents', {
  method: 'POST',
  headers: { 'idempotency-key': `${runId}-payment` },
  body: JSON.stringify({
    amount: 10_000,
    currency: 'LKR',
    merchant_reference: runId,
    description: 'Automated deployment smoke test',
    metadata: { smoke_test: true, run_id: runId },
  }),
});
if (create.body.status !== 'requires_payment_method') throw new Error(`Unexpected initial payment intent state: ${create.body.status}`);
console.log(`[smoke] payment intent ${create.body.id}`);

const token = checkoutToken(create.body.checkout_url);
const confirmation = await fetch(`${API_URL}/checkout/${encodeURIComponent(token)}/confirm`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ card_number: '4242424242424242', expiry: '12/30', cvc: '123' }),
});
const confirmationBody = await confirmation.json().catch(() => ({}));
if (!confirmation.ok) throw new Error(`checkout confirmation -> ${confirmation.status}: ${JSON.stringify(confirmationBody)}`);
if (confirmationBody.payment?.status !== 'succeeded') throw new Error(`Unexpected payment state: ${confirmationBody.payment?.status}`);
const paymentId = confirmationBody.payment.id;
console.log(`[smoke] payment ${paymentId} succeeded`);

const payment = await request(`/v1/payments/${encodeURIComponent(paymentId)}`);
if (payment.body.status !== 'succeeded' || payment.body.amount !== '10000') {
  throw new Error(`Unexpected retrieved payment: ${JSON.stringify(payment.body)}`);
}

const refundKey = `${runId}-refund`;
const refundRequest = {
  method: 'POST',
  headers: { 'idempotency-key': refundKey },
  body: JSON.stringify({ amount: 2_500, reason: 'deployment_smoke_test' }),
};
const refund = await request(`/v1/payments/${encodeURIComponent(paymentId)}/refunds`, refundRequest);
const replay = await request(`/v1/payments/${encodeURIComponent(paymentId)}/refunds`, refundRequest);
if (refund.body.id !== replay.body.id) throw new Error('Idempotent refund replay returned a different refund.');
console.log(`[smoke] refund ${refund.body.id} replay-safe`);

const afterRefund = await request(`/v1/payments/${encodeURIComponent(paymentId)}`);
if (afterRefund.body.status !== 'partially_refunded' || afterRefund.body.amount_refunded !== '2500') {
  throw new Error(`Unexpected payment state after refund: ${JSON.stringify(afterRefund.body)}`);
}

console.log('[smoke] PASS');
