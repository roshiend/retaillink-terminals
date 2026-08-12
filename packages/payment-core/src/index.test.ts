import { describe, expect, it } from 'vitest';
import { completeDemo3ds, processDemoCard, sandboxCards } from './index';

describe('sandbox payment processor', () => {
  it('accepts the documented success card with common separators', () => {
    const result = processDemoCard('4242-4242 4242-4242');

    expect(result).toMatchObject({
      outcome: 'succeeded',
      brand: 'visa',
      last4: '4242',
    });
    expect(result.outcome === 'succeeded' && result.processorRef).toMatch(/^demo_/);
  });

  it('returns the documented decline response', () => {
    expect(processDemoCard(sandboxCards.decline)).toMatchObject({
      outcome: 'declined',
      code: 'card_declined',
      last4: '0002',
    });
  });

  it('rejects undocumented cards without treating them as real cards', () => {
    expect(processDemoCard('4111111111111111')).toMatchObject({
      outcome: 'declined',
      code: 'invalid_test_card',
    });
  });

  it('creates and completes a sandbox 3DS challenge', () => {
    const challenge = processDemoCard(sandboxCards.requiresAction);

    expect(challenge.outcome).toBe('requires_action');
    if (challenge.outcome !== 'requires_action') return;

    expect(completeDemo3ds(challenge.actionToken)).toMatchObject({
      outcome: 'succeeded',
    });
  });

  it('rejects malformed sandbox 3DS tokens', () => {
    expect(() => completeDemo3ds('invalid')).toThrow('Invalid sandbox 3DS token.');
  });
});
