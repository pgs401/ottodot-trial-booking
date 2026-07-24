// Mock PSP — a TEST FIXTURE, not a model of a real payment provider.
// The two-phase authorise/capture shape was chosen for one reason: it is the
// only way to lose a seat race (authorise, then void) without ever moving money.

export type PaymentMethod =
  | 'pm_success' // authorises, then captures cleanly
  | 'pm_decline' // fails at authorise with failureCode card_declined
  // pm_gated: authorise blocks until the test calls releaseGate(ref). The
  // important token — it lets the last-seat race test state the interleaving
  // explicitly instead of depending on a sleep to produce the ordering by luck.
  | 'pm_gated';

// Discriminated on `status`; every variant carries the provider reference.
export type PaymentResult =
  | { status: 'authorised'; ref: string }
  | { status: 'declined'; ref: string; failureCode: 'card_declined' }
  | { status: 'captured'; ref: string }
  | { status: 'voided'; ref: string };

export interface PaymentProvider {
  authorise(method: PaymentMethod): Promise<PaymentResult>;
  capture(ref: string): Promise<PaymentResult>;
  void(ref: string): Promise<PaymentResult>;
}

type AuthState = 'authorised' | 'captured' | 'voided';

export function createMockPsp() {
  const auths = new Map<string, AuthState>(); // real prior authorisations
  const gates = new Map<string, () => void>(); // pending pm_gated releases
  let seq = 0;
  const nextRef = () => `psp_ref_${++seq}`; // deterministic, no randomness

  const provider: PaymentProvider = {
    async authorise(method) {
      const ref = nextRef();
      if (method === 'pm_decline') {
        return { status: 'declined', ref, failureCode: 'card_declined' };
      }
      if (method === 'pm_gated') {
        await new Promise<void>((resolve) => gates.set(ref, resolve));
      }
      auths.set(ref, 'authorised');
      return { status: 'authorised', ref };
    },
    async capture(ref) {
      const state = auths.get(ref);
      if (state === 'captured') return { status: 'captured', ref }; // idempotent
      if (state !== 'authorised') throw new Error(`capture rejected: ${ref} is ${state ?? 'unknown'}`);
      auths.set(ref, 'captured');
      return { status: 'captured', ref };
    },
    async void(ref) {
      const state = auths.get(ref);
      if (state === 'voided') return { status: 'voided', ref }; // idempotent
      if (state !== 'authorised') throw new Error(`void rejected: ${ref} is ${state ?? 'unknown'}`);
      auths.set(ref, 'voided');
      return { status: 'voided', ref };
    },
  };

  // Test-only. Releases a parked pm_gated authorisation by its (deterministic)
  // ref so the race test drives the interleaving; the booking service never
  // calls this.
  function releaseGate(ref: string) {
    const resolve = gates.get(ref);
    if (!resolve) throw new Error(`no gated authorisation for ${ref}`);
    gates.delete(ref);
    resolve();
  }

  return { provider, releaseGate };
}
