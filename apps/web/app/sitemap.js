import { connection } from 'next/server';
import {
  getAllPublicProducts,
  getCategories,
} from '../features/catalog/catalog-data';
import { catalogSitemap } from '../features/catalog/catalog-seo';

export default async function sitemap() {
  await connection();
  const [{ data: categories }, products] = await Promise.all([
    getCategories(),
    getAllPublicProducts(),
  ]);
  return catalogSitemap(categories, products);
}
