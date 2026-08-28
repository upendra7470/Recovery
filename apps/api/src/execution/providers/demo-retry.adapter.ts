import type {
  RecoveryExecutionProvider,
  RetryPaymentRequest,
  RetryPaymentResult,
} from '../../domain/recovery-execution.js';

/**
 * Deterministic demo execution provider.
 *
 * Always accepts retry requests and returns a synthetic provider reference ID.
 * Never contacts any external API. Used exclusively when DEMO_MODE_ENABLED=true
 * to demonstrate the complete RecoveryOS lifecycle without real payment credentials.
 *
 * The returned reference IDs are deterministic and traceable:
 *   demo_order_{executionIdShort}
 */
export class DemoRetryAdapter implements RecoveryExecutionProvider {
  readonly provider = 'demo';

  // eslint-disable-next-line @typescript-eslint/require-await -- deterministic, no I/O needed
  async retryPayment(request: RetryPaymentRequest): Promise<RetryPaymentResult> {
    const shortId = request.executionId.replace(/-/g, '').slice(0, 12);
    const providerReferenceId = `demo_order_${shortId}`;

    return {
      kind: 'accepted',
      providerReferenceId,
    };
  }
}
