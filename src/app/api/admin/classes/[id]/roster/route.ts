import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getRoster } from '@/domain/roster.service';
import { uuid } from '@/lib/validation';
import { errorResponse } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const id = uuid.parse(params.id);
    const r = await getRoster(pool, id);
    return NextResponse.json({
      trial_class_id: r.trialClassId,
      title: r.title,
      subject: r.subject,
      capacity: r.capacity,
      confirmed_count: r.confirmedCount,
      seats_remaining: r.seatsRemaining,
      confirmed: r.confirmed.map((s) => ({
        student_id: s.studentId,
        student_name: s.studentName,
        parent_name: s.parentName,
        parent_email: s.parentEmail,
        confirmed_at: s.confirmedAt,
      })),
      pending_payment_not_on_roster: r.pendingPaymentNotOnRoster,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
