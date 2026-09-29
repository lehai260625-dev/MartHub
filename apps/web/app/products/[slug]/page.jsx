import { notFound } from 'next/navigation';
import { ProductDetail } from '../../../features/catalog/product-detail';
import { getProduct } from '../../../features/catalog/catalog-data';
import {
  productMetadata,
  productStructuredData,
} from '../../../features/catalog/catalog-seo';
import { StructuredData } from '../../../features/catalog/structured-data';
import { ApiClientError } from '../../../lib/api/core';

async function loadProduct(slug) {
  try {
    return (await getProduct(slug)).data;
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) notFound();
    throw error;
  }
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  return productMetadata(await loadProduct(slug));
}

export default async function ProductPage({ params }) {
  const { slug } = await params;
  const product = await loadProduct(slug);
  return (
    <>
      <StructuredData
        data={productStructuredData(product)}
        id="product-structured-data"
      />
      <ProductDetail product={product} />
    </>
  );
}
