import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { bookingService } from '@/domain/services';
import { serializeBooking } from '@/lib/serialize';
import { uuid } from '@/lib/validation';
import { errorResponse } from '@/lib/http';

const ConfirmBody = z.object({
  paymentMethod: z.enum(['pm_success', 'pm_decline', 'pm_gated']),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = uuid.parse(params.id);
    const { paymentMethod } = ConfirmBody.parse(await req.json().catch(() => null));
    const booking = await bookingService.confirmBooking(id, paymentMethod);
    return NextResponse.json(serializeBooking(booking));
  } catch (err) {
    return errorResponse(err);
  }
}
