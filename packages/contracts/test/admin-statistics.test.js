import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import {
  statisticsOverviewQuerySchema,
  statisticsTopProductsQuerySchema,
  statisticsLowStockQuerySchema,
  statisticsAggregateSchema,
  statisticsOverviewResponseSchema,
  statisticsTopProductsResponseSchema,
  statisticsLowStockResponseSchema,
} from '../src/index.js';

test('Statistics range queries enforce real calendar dates, paired dates, maximum inclusive span and sole timezone', () => {
  assert.deepEqual(statisticsOverviewQuerySchema.parse({}), {
    timezone: 'Asia/Ho_Chi_Minh',
  });
  assert.ok(
    statisticsOverviewQuerySchema.safeParse({
      from: '2024-01-01',
      to: '2024-12-31',
    }).success,
  );
  for (const value of [
    { from: '2024-01-01' },
    { to: '2024-01-01' },
    { from: '2024-01-02', to: '2024-01-01' },
    { from: '2024-01-01', to: '2025-01-01' },
    { from: '2023-02-29', to: '2023-03-01' },
    { from: '0000-01-01', to: '0000-01-01' },
    { from: ['2024-01-01', '2024-01-02'], to: '2024-01-02' },
    { timezone: 'UTC' },
    { timezone: ['Asia/Ho_Chi_Minh'] },
    { preset: 'month' },
    { limit: '10' },
  ])
    assert.equal(
      statisticsOverviewQuerySchema.safeParse(value).success,
      false,
      JSON.stringify(value),
    );
});
test('Statistics list limits and operational threshold are bounded strict integers', () => {
  assert.equal(statisticsTopProductsQuerySchema.parse({}).limit, 10);
  assert.deepEqual(statisticsLowStockQuerySchema.parse({}), {
    threshold: 5,
    limit: 10,
  });
  for (const limit of ['0', '51', '1.5', '-1', '1e1', ['10', '20']]) {
    assert.equal(
      statisticsTopProductsQuerySchema.safeParse({ limit }).success,
      false,
    );
    assert.equal(
      statisticsLowStockQuerySchema.safeParse({ limit }).success,
      false,
    );
  }
  for (const threshold of ['-1', '1001', '0.5', ['0', '1']])
    assert.equal(
      statisticsLowStockQuerySchema.safeParse({ threshold }).success,
      false,
    );
  assert.equal(
    statisticsLowStockQuerySchema.parse({ threshold: '0', limit: '50' })
      .threshold,
    0,
  );
  assert.equal(
    statisticsLowStockQuerySchema.parse({ threshold: '1000' }).threshold,
    1000,
  );
  assert.equal(
    statisticsLowStockQuerySchema.safeParse({ from: '2024-01-01' }).success,
    false,
  );
});
test('Aggregate decimal strings are exact beyond BIGINT and reject Number/scientific notation', () => {
  assert.equal(
    statisticsAggregateSchema.parse('18446744073709551614'),
    '18446744073709551614',
  );
  for (const value of [1, 9007199254740992, '1e20', '-1', '1.1', '01'])
    assert.equal(statisticsAggregateSchema.safeParse(value).success, false);
});
test('Statistics OpenAPI matches strict safe runtime allowlists and protected no-store operations', async () => {
  const spec = JSON.parse(
    await readFile(new URL('../openapi.json', import.meta.url), 'utf8'),
  );
  for (const [path, name, schema] of [
    [
      'overview',
      'StatisticsOverviewResponse',
      statisticsOverviewResponseSchema,
    ],
    [
      'top-products',
      'StatisticsTopProductsResponse',
      statisticsTopProductsResponseSchema,
    ],
    [
      'low-stock',
      'StatisticsLowStockResponse',
      statisticsLowStockResponseSchema,
    ],
  ]) {
    assert.deepEqual(spec.components.schemas[name], z.toJSONSchema(schema));
    assert.ok(
      schema.safeParse(
        spec.paths['/admin/statistics/' + path].get.responses[200].content[
          'application/json'
        ].example,
      ).success,
    );
    assert.deepEqual(spec.paths['/admin/statistics/' + path].get.security, [
      { BearerAuth: [] },
    ]);
    assert.equal(
      spec.paths['/admin/statistics/' + path].get.responses[200].headers[
        'Cache-Control'
      ].schema.const,
      'no-store',
    );
    const forbidden = [
      'passwordHash',
      'userId',
      'email',
      'addresses',
      'orderItems',
      'inventoryMovements',
      'auditHistory',
    ];
    for (const field of forbidden)
      assert.equal(
        JSON.stringify(z.toJSONSchema(schema)).includes('"' + field + '"'),
        false,
      );
  }
});
