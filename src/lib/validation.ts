import { z } from 'zod';

// Accept any 8-4-4-4-12 hex UUID shape rather than strict RFC 4122 version /
// variant bits. The seed and other fixtures use synthetic UUIDs (e.g.
// 11111111-1111-1111-1111-111111111111) that are valid Postgres `uuid` values
// but not RFC v4, and they must round-trip through the API. This still rejects
// anything that is not UUID-shaped, so malformed ids remain a 400.
export const uuid = z
  .string()
  .regex(
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
    'invalid id (expected a UUID)',
  );
