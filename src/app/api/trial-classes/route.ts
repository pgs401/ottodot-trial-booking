import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { listTrialClasses } from '@/domain/trial-classes.service';
import { errorResponse } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const classes = await listTrialClasses(pool);
    return NextResponse.json(
      classes.map((c) => ({
        id: c.id,
        subject: c.subject,
        title: c.title,
        starts_at: c.startsAt,
        capacity: c.capacity,
        confirmed_count: c.confirmedCount,
        seats_remaining: c.seatsRemaining,
      })),
    );
  } catch (err) {
    return errorResponse(err);
  }
}
