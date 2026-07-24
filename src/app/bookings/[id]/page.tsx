import { pool } from '@/domain/services';
import { getBookingWithAttempts } from '@/domain/booking.service';
import type { BookingStatus } from '@/domain/booking.service';

export const dynamic = 'force-dynamic';

// One plain-English sentence per status, written for the parent.
const EXPLANATION: Record<BookingStatus, string> = {
  pending_payment: 'Your seat is being held for a few minutes while payment is completed.',
  confirmed: "Your child's seat is confirmed — you're booked in.",
  payment_failed: 'The payment did not go through, so no seat was taken. You can try booking again.',
  seat_lost: 'The class filled up before your payment finished, so the held seat was released and you were not charged.',
  expired: 'The hold expired before payment was completed, so no seat was taken. You can book again.',
};

export default async function BookingStatusPage({ params }: { params: { id: string } }) {
  let data;
  try {
    data = await getBookingWithAttempts(pool, params.id);
  } catch {
    return (
      <main>
        <h1>Booking</h1>
        <p>Booking not found.</p>
      </main>
    );
  }
  const { booking, attempts } = data;

  return (
    <main>
      <h1>Booking status</h1>
      <p>
        <strong>{booking.status}</strong>
      </p>
      <p>{EXPLANATION[booking.status]}</p>

      <h2>Payment attempts</h2>
      {attempts.length === 0 ? (
        <p>No payment attempts yet.</p>
      ) : (
        <ol>
          {attempts.map((a, i) => (
            <li key={i}>
              {a.stage}: {a.status}
              {a.failureCode ? ` (${a.failureCode})` : ''} — {a.amountCents} {a.currency}
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
