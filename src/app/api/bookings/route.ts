import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { bookingService } from '@/domain/services';
import { serializeBooking } from '@/lib/serialize';
import { uuid } from '@/lib/validation';
import { errorResponse } from '@/lib/http';

const CreateBooking = z.object({
  parentId: uuid,
  studentId: uuid,
  trialClassId: uuid,
});

export async function POST(req: NextRequest) {
  try {
    const body = CreateBooking.parse(await req.json().catch(() => null));
    const booking = await bookingService.createBooking(
      body.parentId,
      body.studentId,
      body.trialClassId,
    );
    return NextResponse.json(serializeBooking(booking), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
