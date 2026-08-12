import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Retaillink, RetaillinkError } from './index';

const fetchMock = vi.fn();

describe('Retaillink SDK requests', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('does not label a bodyless DELETE request as JSON', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    const client = new Retaillink({ apiKey: 'sk_test_example' });

    await client.webhooks.remove('endpoint/id');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(url).toBe('http://localhost:3001/v1/webhook_endpoints/endpoint%2Fid');
    expect(init.method).toBe('DELETE');
    expect(headers.get('content-type')).toBeNull();
  });

  it('sends JSON content type and idempotency key with a request body', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ id: 'pi_test' }) });
    const client = new Retaillink({ apiKey: 'sk_test_example' });

    await client.paymentIntents.create({ amount: 5000 }, { idempotencyKey: 'order-1' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('idempotency-key')).toBe('order-1');
    expect(init.body).toBe(JSON.stringify({ amount: 5000 }));
  });

  it('maps API errors to RetaillinkError', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { type: 'authentication_error', code: 'invalid_key', message: 'Invalid key.' } }),
    });
    const client = new Retaillink({ apiKey: 'sk_test_example' });

    await expect(client.balance.retrieve()).rejects.toEqual(
      expect.objectContaining<RetaillinkError>({
        name: 'RetaillinkError',
        status: 401,
        type: 'authentication_error',
        code: 'invalid_key',
        message: 'Invalid key.',
      }),
    );
  });

  it('wraps network failures in RetaillinkError', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const client = new Retaillink({ apiKey: 'sk_test_example' });

    await expect(client.balance.retrieve()).rejects.toMatchObject({
      name: 'RetaillinkError',
      status: 0,
      type: 'network_error',
    });
  });

  it('rejects successful responses that are not JSON', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    });
    const client = new Retaillink({ apiKey: 'sk_test_example' });

    await expect(client.balance.retrieve()).rejects.toMatchObject({
      name: 'RetaillinkError',
      status: 200,
      type: 'invalid_response',
    });
  });
});
