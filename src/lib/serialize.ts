import type { Booking, PaymentAttempt } from '../domain/booking.service';

// Response shaping only (camelCase domain objects -> snake_case JSON). No
// decisions here; this exists so route handlers stay a parse/call/map sandwich.
export function serializeBooking(b: Booking) {
  return {
    id: b.id,
    status: b.status,
    student_id: b.studentId,
    trial_class_id: b.trialClassId,
    parent_id: b.parentId,
    hold_expires_at: b.holdExpiresAt,
    confirmed_at: b.confirmedAt,
    created_at: b.createdAt,
    updated_at: b.updatedAt,
  };
}

export function serializeAttempt(a: PaymentAttempt) {
  return {
    stage: a.stage,
    status: a.status,
    provider_ref: a.providerRef,
    amount_cents: a.amountCents,
    currency: a.currency,
    failure_code: a.failureCode,
    created_at: a.createdAt,
  };
}
