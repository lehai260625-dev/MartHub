import { z } from './schema-runtime.js';

export const moneySchema = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .refine(
    (value) =>
      value.length < 19 ||
      (value.length === 19 && value <= '9223372036854775807'),
    'Amount exceeds BIGINT range.',
  );
