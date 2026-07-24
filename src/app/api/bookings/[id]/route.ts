import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getBookingWithAttempts } from '@/domain/booking.service';
import { serializeBooking, serializeAttempt } from '@/lib/serialize';
import { uuid } from '@/lib/validation';
import { errorResponse } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const id = uuid.parse(params.id);
    const { booking, attempts } = await getBookingWithAttempts(pool, id);
    return NextResponse.json({
      booking: serializeBooking(booking),
      payment_attempts: attempts.map(serializeAttempt),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
