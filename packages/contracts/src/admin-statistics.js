import { z } from 'zod';
import { moneySchema } from './money.js';
import { productCardSchema } from './catalog.js';
import { customerOrderStatusSchema } from './orders.js';

export const STATISTICS_TIMEZONE = 'Asia/Ho_Chi_Minh';
export const statisticsAggregateSchema = z.string().regex(/^(0|[1-9]\d*)$/u);
const calendarDate = z.iso
  .date()
  .refine((v) => !v.startsWith('0000-'), 'Year must be at least 0001.');
const rangeFields = {
  from: calendarDate.optional(),
  to: calendarDate.optional(),
  timezone: z
    .literal(STATISTICS_TIMEZONE)
    .optional()
    .default(STATISTICS_TIMEZONE),
};
const positiveLimit = z
  .string()
  .regex(/^[1-9]\d*$/u)
  .transform(Number)
  .pipe(z.int().min(1).max(50))
  .optional()
  .default(10);
const checkRange = (v) =>
  (v.from === undefined) === (v.to === undefined) &&
  (!v.from ||
    (v.from <= v.to &&
      (Date.parse(v.to) - Date.parse(v.from)) / 86400000 < 366));
export const statisticsOverviewQuerySchema = z
  .object(rangeFields)
  .strict()
  .refine(
    checkRange,
    'Supply both dates in ascending order, at most 366 days inclusive.',
  );
export const statisticsTopProductsQuerySchema = z
  .object({ ...rangeFields, limit: positiveLimit })
  .strict()
  .refine(
    checkRange,
    'Supply both dates in ascending order, at most 366 days inclusive.',
  );
export const statisticsLowStockQuerySchema = z
  .object({
    threshold: z
      .string()
      .regex(/^(0|[1-9]\d*)$/u)
      .transform(Number)
      .pipe(z.int().min(0).max(1000))
      .optional()
      .default(5),
    limit: positiveLimit,
  })
  .strict();
export const statisticsRangeSchema = z
  .object({
    from: calendarDate,
    to: calendarDate,
    timezone: z.literal(STATISTICS_TIMEZONE),
    startInclusive: z.iso.datetime(),
    endExclusive: z.iso.datetime(),
  })
  .strict();
export const statisticsOverviewResponseSchema = z
  .object({
    data: z
      .object({
        range: statisticsRangeSchema,
        revenue: statisticsAggregateSchema,
        deliveredOrderCount: statisticsAggregateSchema,
        unitsSold: statisticsAggregateSchema,
        createdOrderCount: statisticsAggregateSchema,
        statusCounts: z
          .object(
            Object.fromEntries(
              customerOrderStatusSchema.options.map((status) => [
                status,
                statisticsAggregateSchema,
              ]),
            ),
          )
          .strict(),
      })
      .strict(),
  })
  .strict();
export const statisticsTopProductsResponseSchema = z
  .object({
    data: z
      .object({
        range: statisticsRangeSchema,
        limit: z.int().min(1).max(50),
        totalProducts: statisticsAggregateSchema,
        items: z
          .array(
            z
              .object({
                productId: z.uuid(),
                sku: z.string(),
                productName: z.string(),
                imageUrl: z.url().nullable(),
                sellingUnit: z.string(),
                soldQuantity: statisticsAggregateSchema,
                revenue: statisticsAggregateSchema,
              })
              .strict(),
          )
          .max(50),
      })
      .strict(),
  })
  .strict();
export const statisticsLowStockResponseSchema = z
  .object({
    data: z
      .object({
        threshold: z.int().min(0).max(1000),
        limit: z.int().min(1).max(50),
        totalProducts: statisticsAggregateSchema,
        items: z
          .array(
            z
              .object({
                productId: z.uuid(),
                sku: z.string(),
                name: z.string(),
                quantity: z.int().nonnegative(),
                currentPrice: moneySchema,
                availability: productCardSchema.shape.availability,
              })
              .strict(),
          )
          .max(50),
      })
      .strict(),
  })
  .strict();
