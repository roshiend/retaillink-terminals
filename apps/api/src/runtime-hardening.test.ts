import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from './bootstrap.js';

describe.sequential('runtime hardening', () => {
  beforeAll(async () => {
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('separates database readiness from liveness and emits defensive headers', async () => {
    const health = await app.inject({ method: 'GET', url: '/health' });
    const ready = await app.inject({ method: 'GET', url: '/ready' });

    expect(health.statusCode).toBe(200);
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({ status: 'ready', database: 'ok' });
    expect(health.headers['x-content-type-options']).toBe('nosniff');
    expect(health.headers['x-frame-options']).toBe('DENY');
    expect(health.headers['cache-control']).toBe('no-store');
    expect(health.headers['x-request-id']).toBeTruthy();
  });

  it('rejects declared request bodies above the configured limit', async () => {
    const previous = process.env.MAX_BODY_BYTES;
    process.env.MAX_BODY_BYTES = '32';
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/signup',
        headers: { 'content-length': '1000' },
        payload: '{}',
      });
      expect(response.statusCode).toBe(413);
      expect(response.json().error.code).toBe('payload_too_large');
    } finally {
      if (previous === undefined) delete process.env.MAX_BODY_BYTES;
      else process.env.MAX_BODY_BYTES = previous;
    }
  });

  it('can throttle abusive request bursts when enabled', async () => {
    const previousEnabled = process.env.ENABLE_RATE_LIMIT;
    const previousMax = process.env.RATE_LIMIT_API_MAX;
    process.env.ENABLE_RATE_LIMIT = 'true';
    process.env.RATE_LIMIT_API_MAX = '1';
    try {
      const first = await app.inject({ method: 'GET', url: '/v1/payment_intents' });
      const second = await app.inject({ method: 'GET', url: '/v1/payment_intents' });
      expect(first.statusCode).toBe(401);
      expect(second.statusCode).toBe(429);
      expect(second.json().error.code).toBe('rate_limit_exceeded');
      expect(second.headers['retry-after']).toBeTruthy();
    } finally {
      if (previousEnabled === undefined) delete process.env.ENABLE_RATE_LIMIT;
      else process.env.ENABLE_RATE_LIMIT = previousEnabled;
      if (previousMax === undefined) delete process.env.RATE_LIMIT_API_MAX;
      else process.env.RATE_LIMIT_API_MAX = previousMax;
    }
  });
});
