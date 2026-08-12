export type DemoProcessorResult =
  | { outcome: 'succeeded'; brand: 'visa'; last4: string; processorRef: string }
  | { outcome: 'declined'; brand: 'visa'; last4: string; code: string; message: string }
  | { outcome: 'requires_action'; brand: 'visa'; last4: string; actionToken: string };

const TEST_CARDS = {
  success: '4242424242424242',
  decline: '4000000000000002',
  requiresAction: '4000002500003155',
} as const;

export function processDemoCard(cardNumber: string): DemoProcessorResult {
  const normalized = cardNumber.replace(/\s|-/g, '');
  const last4 = normalized.slice(-4);

  if (normalized === TEST_CARDS.success) {
    return {
      outcome: 'succeeded',
      brand: 'visa',
      last4,
      processorRef: `demo_${crypto.randomUUID()}`,
    };
  }

  if (normalized === TEST_CARDS.requiresAction) {
    return {
      outcome: 'requires_action',
      brand: 'visa',
      last4,
      actionToken: `3ds_test_${crypto.randomUUID()}`,
    };
  }

  return {
    outcome: 'declined',
    brand: 'visa',
    last4,
    code: normalized === TEST_CARDS.decline ? 'card_declined' : 'invalid_test_card',
    message:
      normalized === TEST_CARDS.decline
        ? 'The sandbox card was declined.'
        : 'Use one of the documented sandbox card numbers.',
  };
}

export function completeDemo3ds(actionToken: string) {
  if (!actionToken.startsWith('3ds_test_')) {
    throw new Error('Invalid sandbox 3DS token.');
  }

  return {
    outcome: 'succeeded' as const,
    processorRef: `demo_${crypto.randomUUID()}`,
  };
}

export const sandboxCards = TEST_CARDS;
