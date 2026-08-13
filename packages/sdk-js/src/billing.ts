export type BillingClientOptions = {
  apiKey: string;
  baseUrl?: string;
};

export type SubscriptionInterval = 'day' | 'week' | 'month' | 'year';

export type CreateSubscriptionParams = {
  customer: string;
  amount: number;
  currency?: string;
  interval: SubscriptionInterval;
  interval_count?: number;
  description?: string;
};

export type CancelSubscriptionParams = {
  at_period_end?: boolean;
};

export class RetaillinkBillingError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly type?: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'RetaillinkBillingError';
  }
}

export class RetaillinkBilling {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: BillingClientOptions) {
    if (!options.apiKey?.startsWith('sk_test_')) throw new Error('A sandbox sk_test_ API key is required.');
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? 'http://localhost:3001').replace(/\/$/, '');
  }

  subscriptions = {
    create: (params: CreateSubscriptionParams) => this.request('/v1/subscriptions', { method: 'POST', body: params }),
    list: () => this.request('/v1/subscriptions'),
    retrieve: (id: string) => this.request(`/v1/subscriptions/${encodeURIComponent(id)}`),
    cancel: (id: string, params: CancelSubscriptionParams = { at_period_end: true }) =>
      this.request(`/v1/subscriptions/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: params }),
    runCycle: (id: string) => this.request(`/v1/subscriptions/${encodeURIComponent(id)}/run_cycle`, { method: 'POST', body: {} }),
  };

  invoices = {
    list: () => this.request('/v1/invoices'),
    retrieve: (id: string) => this.request(`/v1/invoices/${encodeURIComponent(id)}`),
    void: (id: string) => this.request(`/v1/invoices/${encodeURIComponent(id)}/void`, { method: 'POST', body: {} }),
  };

  private async request(path: string, options: { method?: 'GET' | 'POST'; body?: unknown } = {}) {
    const headers: Record<string, string> = { authorization: `Bearer ${this.apiKey}` };
    if (options.body !== undefined) headers['content-type'] = 'application/json';

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: options.method ?? 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch {
      throw new RetaillinkBillingError('Unable to reach the Retaillink API.', 0, 'network_error');
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new RetaillinkBillingError(
        data?.error?.message ?? `Retaillink request failed with HTTP ${response.status}`,
        response.status,
        data?.error?.type,
        data?.error?.code,
      );
    }
    return data;
  }
}
