import { pool } from '../lib/db';
import { createMockPsp } from '../payments/mock-psp';
import { createBookingService } from './booking.service';

// App-wide composition root. One shared pool and one mock-PSP instance (its
// in-memory authorisation state must persist across requests) back a single
// booking service that the route handlers import.
const { provider } = createMockPsp();

export const bookingService = createBookingService({ pool, psp: provider });
export { pool };
