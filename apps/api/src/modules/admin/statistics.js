import { Prisma } from '@prisma/client';
import {
  statisticsOverviewQuerySchema,
  statisticsTopProductsQuerySchema,
  statisticsLowStockQuerySchema,
  STATISTICS_TIMEZONE,
  customerOrderStatusSchema,
} from '@marthub/contracts';
import { ApiError } from '../../middleware/platform.js';

function validate(schema, input) {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new ApiError(
    422,
    'VALIDATION_ERROR',
    'Check statistics query options.',
    result.error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    })),
  );
}
async function resolveRange(tx, query) {
  // Serialize UTC boundaries in PostgreSQL, avoiding adapter/session timezone
  // decoding of timestamptz (including historical offset seconds).
  const [row] = await tx.$queryRaw`
    WITH clock AS (SELECT (CURRENT_TIMESTAMP AT TIME ZONE ${STATISTICS_TIMEZONE})::date AS today),
    dates AS (SELECT today, COALESCE(${query.from ?? null}::date, today - 29) AS first,
      COALESCE(${query.to ?? null}::date, today) AS last FROM clock)
    SELECT to_char(first,'YYYY-MM-DD') AS "from", to_char(last,'YYYY-MM-DD') AS "to",
      first <= last AND last <= today AND first <= today AND last - first < 366 AS valid,
      to_char((first::timestamp AT TIME ZONE ${STATISTICS_TIMEZONE}) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "startInclusive",
      to_char(((last + 1)::timestamp AT TIME ZONE ${STATISTICS_TIMEZONE}) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "endExclusive" FROM dates`;
  if (!row.valid)
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'Dates must not be future dates and must span at most 366 days.',
    );
  return {
    from: row.from,
    to: row.to,
    timezone: STATISTICS_TIMEZONE,
    startInclusive: row.startInclusive,
    endExclusive: row.endExclusive,
  };
}
export const deliveredPopulation = (range) =>
  Prisma.sql`status = 'DELIVERED' AND delivered_at >= ${new Date(range.startInclusive)} AND delivered_at < ${new Date(range.endExclusive)}`;

// Export query builders so representative EXPLAIN reviews use exactly runtime SQL.
export function overviewSql(range) {
  return Prisma.sql`
    WITH delivered AS MATERIALIZED (SELECT id,total FROM orders WHERE ${deliveredPopulation(range)}),
    created AS MATERIALIZED (SELECT status FROM orders WHERE created_at >= ${new Date(range.startInclusive)} AND created_at < ${new Date(range.endExclusive)})
    SELECT COALESCE((SELECT SUM(total) FROM delivered),0)::text AS revenue,
      (SELECT COUNT(*) FROM delivered)::text AS "deliveredOrderCount",
      COALESCE((SELECT SUM(i.quantity::numeric) FROM order_items i JOIN delivered d ON d.id=i.order_id),0)::text AS "unitsSold",
      (SELECT COUNT(*) FROM created)::text AS "createdOrderCount",
      COALESCE((SELECT jsonb_object_agg(status,n) FROM (SELECT status,COUNT(*)::text n FROM created GROUP BY status) grouped),'{}'::jsonb) AS "statusCounts"`;
}
export function topProductsSql(range, limit) {
  return Prisma.sql`
    WITH purchases AS MATERIALIZED (
      SELECT i.product_id,i.sku,i.product_name,i.image_url,i.selling_unit,i.quantity,i.line_total,o.delivered_at,o.id AS order_id
      FROM orders o JOIN order_items i ON i.order_id=o.id WHERE ${deliveredPopulation(range)}),
    totals AS (SELECT product_id,SUM(quantity::numeric) AS sold,SUM(line_total) AS revenue FROM purchases GROUP BY product_id),
    latest AS (SELECT DISTINCT ON (product_id) product_id,sku,product_name,image_url,selling_unit
      FROM purchases ORDER BY product_id,delivered_at DESC,order_id DESC),
    ranked AS (SELECT t.*,l.sku,l.product_name,l.image_url,l.selling_unit FROM totals t JOIN latest l USING(product_id)
      ORDER BY sold DESC,revenue DESC,product_id ASC LIMIT ${limit})
    SELECT (SELECT COUNT(*) FROM totals)::text AS "totalProducts",
      COALESCE((SELECT jsonb_agg(jsonb_build_object('productId',product_id,'sku',sku,'productName',product_name,'imageUrl',image_url,'sellingUnit',selling_unit,'soldQuantity',sold::text,'revenue',revenue::text)
        ORDER BY sold DESC,revenue DESC,product_id ASC) FROM ranked),'[]'::jsonb) AS items`;
}
export function lowStockSql(threshold, limit) {
  return Prisma.sql`
    WITH eligible AS MATERIALIZED (
      SELECT p.id AS product_id,p.sku,p.name,i.quantity_on_hand AS quantity,price.price
      FROM products p JOIN categories c ON c.id=p.category_id LEFT JOIN categories parent ON parent.id=c.parent_id
      JOIN inventory i ON i.product_id=p.id
      JOIN LATERAL (SELECT h.price FROM product_price_history h WHERE h.product_id=p.id AND h.starts_at <= CURRENT_TIMESTAMP
        AND (h.ends_at IS NULL OR h.ends_at > CURRENT_TIMESTAMP) ORDER BY h.starts_at DESC,h.id ASC LIMIT 1) price ON true
      WHERE p.status='ACTIVE' AND p.archived_at IS NULL AND c.status='ACTIVE' AND c.archived_at IS NULL
        AND (c.parent_id IS NULL OR (parent.status='ACTIVE' AND parent.archived_at IS NULL)) AND i.quantity_on_hand <= ${threshold}),
    ranked AS (SELECT * FROM eligible ORDER BY quantity ASC,name ASC,product_id ASC LIMIT ${limit})
    SELECT (SELECT COUNT(*) FROM eligible)::text AS "totalProducts",
      COALESCE((SELECT jsonb_agg(jsonb_build_object('productId',product_id,'sku',sku,'name',name,'quantity',quantity,'currentPrice',price::text,
        'availability',jsonb_build_object('status',CASE WHEN quantity>0 THEN 'IN_STOCK' ELSE 'OUT_OF_STOCK' END,'canAddToCart',quantity>0))
        ORDER BY quantity ASC,name ASC,product_id ASC) FROM ranked),'[]'::jsonb) AS items`;
}
export function createAdminStatisticsService({ prisma }) {
  const read = (run) =>
    prisma.$transaction(run, { isolationLevel: 'RepeatableRead' });
  return {
    async overview(input) {
      const query = validate(statisticsOverviewQuerySchema, input);
      return read(async (tx) => {
        const range = await resolveRange(tx, query);
        const [data] = await tx.$queryRaw(overviewSql(range));
        return {
          range,
          ...data,
          statusCounts: {
            ...Object.fromEntries(
              customerOrderStatusSchema.options.map((s) => [s, '0']),
            ),
            ...data.statusCounts,
          },
        };
      });
    },
    async topProducts(input) {
      const query = validate(statisticsTopProductsQuerySchema, input);
      return read(async (tx) => {
        const range = await resolveRange(tx, query);
        const [data] = await tx.$queryRaw(topProductsSql(range, query.limit));
        return { range, limit: query.limit, ...data };
      });
    },
    async lowStock(input) {
      const query = validate(statisticsLowStockQuerySchema, input);
      return read(async (tx) => {
        const [data] = await tx.$queryRaw(
          lowStockSql(query.threshold, query.limit),
        );
        return { threshold: query.threshold, limit: query.limit, ...data };
      });
    },
  };
}
