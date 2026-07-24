// This UI exists only to make the backend paths reachable by hand: a reviewer
// picks a child, a class, and a payment method and submits. No correctness
// decision is taken in the browser — capacity, duplicates, the seat claim, and
// the payment outcome are all decided by the domain service and the database.
// The page just gathers input and shows what the backend returned.
import { redirect } from 'next/navigation';
import { pool, bookingService } from '@/domain/services';
import { listTrialClasses } from '@/domain/trial-classes.service';

export const dynamic = 'force-dynamic';

async function book(formData: FormData) {
  'use server';
  const parentId = String(formData.get('parentId'));
  const studentId = String(formData.get('studentId'));
  const trialClassId = String(formData.get('trialClassId'));
  const paymentMethod = String(formData.get('paymentMethod'));
  // pm_gated is a test-only token and must never reach the service from the UI.
  const allowed = ['pm_success', 'pm_decline', 'pm_slow'];
  if (!allowed.includes(paymentMethod)) redirect(`/?parentId=${parentId}&error=Invalid+payment+method`);

  let bookingId: string;
  try {
    const booking = await bookingService.createBooking(parentId, studentId, trialClassId);
    bookingId = booking.id;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not create booking';
    redirect(`/?parentId=${parentId}&error=${encodeURIComponent(message)}`);
  }
  await bookingService.confirmBooking(bookingId, paymentMethod as 'pm_success' | 'pm_decline' | 'pm_slow');
  redirect(`/bookings/${bookingId}`);
}

export default async function ParentFlow({
  searchParams,
}: {
  searchParams: { parentId?: string; error?: string };
}) {
  const parentId = searchParams.parentId;
  const parents = (await pool.query<{ id: string; name: string }>('SELECT id, name FROM parents ORDER BY name')).rows;
  const children = parentId
    ? (await pool.query<{ id: string; name: string }>('SELECT id, name FROM students WHERE parent_id = $1 ORDER BY name', [parentId])).rows
    : [];
  const classes = await listTrialClasses(pool);

  return (
    <main>
      <h1>Book a trial class</h1>
      {searchParams.error && <p role="alert">{searchParams.error}</p>}

      <h2>1. Select parent</h2>
      <form method="get">
        <select name="parentId" defaultValue={parentId ?? ''} aria-label="Parent">
          <option value="" disabled>
            Choose a parent
          </option>
          {parents.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>{' '}
        <button type="submit">Load children</button>
      </form>

      {parentId && (
        <form action={book}>
          <input type="hidden" name="parentId" value={parentId} />

          <h2>2. Select child</h2>
          <select name="studentId" required aria-label="Child">
            {children.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <h2>3. Select class</h2>
          <select name="trialClassId" required aria-label="Class">
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.subject} — {c.title} — {c.seatsRemaining} seat(s) remaining
              </option>
            ))}
          </select>

          <h2>4. Payment method</h2>
          <select name="paymentMethod" defaultValue="pm_success" aria-label="Payment method">
            <option value="pm_success">pm_success (authorise + capture)</option>
            <option value="pm_decline">pm_decline (card declined)</option>
            <option value="pm_slow">pm_slow (authorises after a delay)</option>
          </select>

          <p>
            <button type="submit">Book</button>
          </p>
        </form>
      )}
    </main>
  );
}
