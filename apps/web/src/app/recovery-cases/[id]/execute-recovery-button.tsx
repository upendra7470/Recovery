'use client';

import { useState, useCallback } from 'react';
import { requestExecution, type CheckoutData } from '@/lib/api/recovery-executions';

type Feedback =
  | { tone: 'ok'; message: string }
  | { tone: 'warn'; message: string }
  | { tone: 'error'; message: string };

interface RazorpayWindow extends Window {
  Razorpay: new (options: RazorpayOptions) => RazorpayInstance;
}

interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  handler: (response: RazorpayResponse) => void;
  modal?: {
    ondismiss?: () => void;
  };
}

interface RazorpayInstance {
  open: () => void;
  on: (event: string, handler: (response: { error: { description: string } }) => void) => void;
}

interface RazorpayResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

function loadRazorpayScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window !== 'undefined' && (window as unknown as RazorpayWindow).Razorpay) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Razorpay Checkout'));
    document.head.appendChild(script);
  });
}

export function ExecuteRecoveryButton({
  opportunityId,
  amount,
  currency,
  failureReason,
}: {
  opportunityId: string;
  amount: number;
  currency: string;
  failureReason?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [checkoutBusy, setCheckoutBusy] = useState(false);

  const openCheckout = useCallback(
    async (checkout: CheckoutData, originalAmount: number, originalCurrency: string) => {
      setCheckoutBusy(true);
      try {
        await loadRazorpayScript();
        const RazorpayConstructor = (window as unknown as RazorpayWindow).Razorpay;
        const options: RazorpayOptions = {
          key: checkout.keyId,
          amount: originalAmount,
          currency: originalCurrency,
          name: 'Recovery Payment',
          description: `Retry payment for ${failureReason ?? 'failed transaction'}`,
          order_id: checkout.orderId,
          handler: () => {
            setFeedback({
              tone: 'ok',
              message: 'Payment initiated successfully. Awaiting confirmation from Razorpay.',
            });
            setCheckoutBusy(false);
          },
          modal: {
            ondismiss: () => {
              setFeedback({
                tone: 'warn',
                message: 'Payment window closed. The order is still valid for a limited time.',
              });
              setCheckoutBusy(false);
            },
          },
        };
        const rzp = new RazorpayConstructor(options);
        rzp.on('payment.failed', (response: { error: { description: string } }) => {
          setFeedback({
            tone: 'error',
            message: `Payment failed: ${response.error.description}`,
          });
          setCheckoutBusy(false);
        });
        rzp.open();
      } catch (error) {
        setFeedback({
          tone: 'error',
          message: error instanceof Error ? error.message : 'Failed to open payment window',
        });
        setCheckoutBusy(false);
      }
    },
    [failureReason]
  );

  async function onExecute() {
    setBusy(true);
    setFeedback(null);
    try {
      const result = await requestExecution(opportunityId);
      switch (result.kind) {
        case 'ok':
          if (result.body.outcome === 'created') {
            if (result.body.checkout) {
              // Open Razorpay Checkout for the customer
              await openCheckout(result.body.checkout, amount, currency);
              setFeedback({
                tone: 'ok',
                message:
                  'Payment window opened. Complete the payment to recover the failed transaction.',
              });
            } else if (result.body.execution.status === 'SUCCEEDED') {
              setFeedback({
                tone: 'ok',
                message:
                  'Recovery request submitted — awaiting payment outcome. This is not a confirmed recovery.',
              });
            } else {
              setFeedback({
                tone: 'ok',
                message: `Execution recorded (status: ${result.body.execution.status}).`,
              });
            }
          } else {
            setFeedback({
              tone: 'ok',
              message: `Existing execution returned (status: ${result.body.execution.status}) — no duplicate provider call was made.`,
            });
          }
          break;
        case 'blocked':
          setFeedback({
            tone: 'warn',
            message: `Blocked by the safety policy (${result.reason}): ${result.detail}`,
          });
          break;
        case 'disabled':
        case 'unavailable':
        case 'error':
          setFeedback({ tone: 'error', message: result.message });
          break;
      }
    } finally {
      setBusy(false);
    }
  }

  const toneClasses =
    feedback?.tone === 'ok'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : feedback?.tone === 'warn'
        ? 'border-amber-200 bg-amber-50 text-amber-900'
        : 'border-rose-200 bg-rose-50 text-rose-800';

  return (
    <div>
      <button
        type="button"
        onClick={onExecute}
        disabled={busy || checkoutBusy}
        className="inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {checkoutBusy ? 'Opening Payment…' : busy ? 'Executing…' : 'Execute Recovery'}
      </button>
      <p className="mt-2 max-w-md text-[11px] leading-relaxed text-slate-500">
        Execution is governed by the deterministic safety policy. AI advice cannot
        authorize execution.
      </p>
      {feedback && (
        <div
          className={`mt-3 max-w-xl rounded-lg border px-3 py-2 text-xs leading-relaxed ${toneClasses}`}
          role="status"
        >
          {feedback.message}
        </div>
      )}
    </div>
  );
}
