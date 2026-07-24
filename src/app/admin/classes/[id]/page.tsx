import { pool } from '@/domain/services';
import { getRoster } from '@/domain/roster.service';

export const dynamic = 'force-dynamic';

export default async function RosterPage({ params }: { params: { id: string } }) {
  let roster;
  try {
    roster = await getRoster(pool, params.id);
  } catch {
    return (
      <main>
        <h1>Roster</h1>
        <p>Class not found.</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Roster — {roster.title}</h1>
      <p>
        {roster.subject}. Seats remaining: {roster.seatsRemaining} of {roster.capacity}.
      </p>

      <h2>Confirmed students ({roster.confirmed.length})</h2>
      {roster.confirmed.length === 0 ? (
        <p>No confirmed students yet.</p>
      ) : (
        <ol>
          {roster.confirmed.map((s) => (
            <li key={s.studentId}>
              {s.studentName} — parent {s.parentName} ({s.parentEmail})
              {s.confirmedAt ? ` — confirmed ${new Date(s.confirmedAt).toISOString()}` : ''}
            </li>
          ))}
        </ol>
      )}

      <h2>Pending bookings — NOT on the roster</h2>
      <p>
        {roster.pendingPaymentNotOnRoster} booking(s) are mid-payment. They hold no seat and are not part
        of the roster above; they appear here only so the count is visible.
      </p>
    </main>
  );
}
