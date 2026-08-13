export type RetaillinkOptions = {
  apiKey: string;
  baseUrl?: string;
};

type RequestOptions = {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  idempotencyKey?: string;
};

export class RetaillinkError extends Error {
  status: number;
  type?: string;
  code?: string;

  constructor(message: string, status: number, type?: string, code?: string) {
    super(message);
    this.name = 'RetaillinkError';
    this.status = status;
    this.type = type;
    this.code = code;
  }
}

export class Retaillink {
  private apiKey: string;
  private baseUrl: string;

  constructor(options: RetaillinkOptions) {
    if (!options.apiKey?.startsWith('sk_test_')) throw new Error('A sandbox sk_test_ API key is required.');
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? 'http://localhost:3001').replace(/\/$/, '');
  }

  paymentIntents = {
    create: (params: { amount: number; currency?: string; merchant_reference?: string; description?: string; metadata?: Record<string, unknown> }, options?: { idempotencyKey?: string }) =>
      this.request('/v1/payment_intents', { method: 'POST', body: params, idempotencyKey: options?.idempotencyKey }),
    list: () => this.request('/v1/payment_intents'),
    retrieve: (id: string) => this.request(`/v1/payment_intents/${encodeURIComponent(id)}`),
  };

  payments = {
    list: () => this.request('/v1/payments'),
    retrieve: (id: string) => this.request(`/v1/payments/${encodeURIComponent(id)}`),
    refund: (id: string, params: { amount?: number; reason?: string } = {}) =>
      this.request(`/v1/payments/${encodeURIComponent(id)}/refunds`, { method: 'POST', body: params }),
  };

  refunds = {
    list: () => this.request('/v1/refunds'),
  };

  customers = {
    create: (params: { name?: string; email?: string; phone?: string; metadata?: Record<string, unknown> }) =>
      this.request('/v1/customers', { method: 'POST', body: params }),
    list: () => this.request('/v1/customers'),
    retrieve: (id: string) => this.request(`/v1/customers/${encodeURIComponent(id)}`),
    update: (id: string, params: { name?: string | null; email?: string | null; phone?: string | null; metadata?: Record<string, unknown> | null }) =>
      this.request(`/v1/customers/${encodeURIComponent(id)}`, { method: 'POST', body: params }),
    remove: (id: string) => this.request(`/v1/customers/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  };

  balance = {
    retrieve: () => this.request('/v1/balance'),
  };

  settlements = {
    list: () => this.request('/v1/settlements'),
  };

  webhooks = {
    list: () => this.request('/v1/webhook_endpoints'),
    create: (url: string) => this.request('/v1/webhook_endpoints', { method: 'POST', body: { url } }),
    remove: (id: string) => this.request(`/v1/webhook_endpoints/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    deliveries: () => this.request('/v1/webhook_deliveries'),
  };

  private async request(path: string, options: RequestOptions = {}) {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.apiKey}`,
      ...(options.idempotencyKey ? { 'idempotency-key': options.idempotencyKey } : {}),
    };
    if (options.body !== undefined) headers['content-type'] = 'application/json';

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: options.method ?? 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch {
      throw new RetaillinkError('Unable to reach the Retaillink API.', 0, 'network_error');
    }

    let data: any;
    try {
      data = await response.json();
    } catch {
      if (response.ok) throw new RetaillinkError('The Retaillink API returned an invalid response.', response.status, 'invalid_response');
      data = {};
    }
    if (!response.ok) {
      throw new RetaillinkError(
        data?.error?.message ?? `Retaillink request failed with HTTP ${response.status}`,
        response.status,
        data?.error?.type,
        data?.error?.code,
      );
    }
    return data;
  }
}
