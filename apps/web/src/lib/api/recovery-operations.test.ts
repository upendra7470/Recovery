import { describe, expect, it } from 'vitest';
import { describeReconciliationLabel } from './recovery-operations';

describe('describeReconciliationLabel', () => {
  it('never conflates provider acceptance with payment recovery', () => {
    const awaiting = describeReconciliationLabel('awaiting_payment_outcome');
    expect(awaiting.label).toBe('Awaiting payment outcome');
    expect(awaiting.label.toLowerCase()).not.toContain('recovered');
  });

  it('labels webhook-confirmed recovery positively', () => {
    expect(describeReconciliationLabel('recovered').label).toContain('webhook-confirmed');
  });

  it.each([
    ['failed', 'Attempt failed'],
    ['opportunity_closed', 'Opportunity closed'],
    ['not_applicable', 'Not applicable'],
  ] as const)('maps %s to %s', (input, label) => {
    expect(describeReconciliationLabel(input).label).toBe(label);
  });
});
