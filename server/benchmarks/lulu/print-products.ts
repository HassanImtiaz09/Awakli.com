/**
 * Print Product Definitions — Lulu POD Package Configuration
 *
 * Centralizes all print product variants, pricing, and Lulu package IDs.
 * Wave 5A: B5 perfect-bound as default, with trim size selector exposed.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type TrimSize = 'b5' | 'a5' | 'tankobon' | 'us_trade';
export type ColorInterior = 'FC' | 'BW'; // Full Color | Black & White
export type BindingType = 'PERFECT' | 'SADDLE'; // Perfect bound | Saddle-stitch
export type PaperWeight = '060' | '070' | '080'; // gsm categories

export interface PrintProduct {
  id: string;
  name: string;
  trimSize: TrimSize;
  trimLabel: string;
  dimensionsMm: { width: number; height: number };
  dimensionsIn: { width: number; height: number };
  colorInterior: ColorInterior;
  bindingType: BindingType;
  paperWeight: PaperWeight;
  luluPackageId: string;
  /** Base price in cents (before page-count surcharge) */
  basePriceCents: number;
  /** Additional cost per page in cents */
  perPageCents: number;
  /** Minimum page count */
  minPages: number;
  /** Maximum page count */
  maxPages: number;
  /** Creator royalty percentage (decimal, e.g., 0.80 = 80%) */
  creatorRoyaltyRate: number;
  /** Platform margin percentage (decimal) */
  platformMarginRate: number;
  /** Whether this is the default product */
  isDefault: boolean;
  /** Description for UI */
  description: string;
}

// ─── Product Catalog ──────────────────────────────────────────────────────────

export const PRINT_PRODUCTS: PrintProduct[] = [
  {
    id: 'b5-color-perfect',
    name: 'B5 Full Color (Default)',
    trimSize: 'b5',
    trimLabel: 'B5 (176×250mm)',
    dimensionsMm: { width: 176, height: 250 },
    dimensionsIn: { width: 6.93, height: 9.84 },
    colorInterior: 'FC',
    bindingType: 'PERFECT',
    paperWeight: '060',
    luluPackageId: '0693X0984FCPERFECT060UW444',
    basePriceCents: 1499, // $14.99 base
    perPageCents: 8, // $0.08 per page
    minPages: 24,
    maxPages: 800,
    creatorRoyaltyRate: 0.15, // 15% to creator
    platformMarginRate: 0.20, // 20% platform margin
    isDefault: true,
    description: 'Standard manga format. Full color, perfect bound. Best for serialized chapters.',
  },
  {
    id: 'a5-color-perfect',
    name: 'A5 Full Color',
    trimSize: 'a5',
    trimLabel: 'A5 (148×210mm)',
    dimensionsMm: { width: 148, height: 210 },
    dimensionsIn: { width: 5.83, height: 8.27 },
    colorInterior: 'FC',
    bindingType: 'PERFECT',
    paperWeight: '060',
    luluPackageId: '0583X0827FCPERFECT060UW444',
    basePriceCents: 1299, // $12.99 base
    perPageCents: 7,
    minPages: 24,
    maxPages: 800,
    creatorRoyaltyRate: 0.15,
    platformMarginRate: 0.20,
    isDefault: false,
    description: 'Compact format. Full color, perfect bound. Good for doujinshi-style releases.',
  },
  {
    id: 'tankobon-color-perfect',
    name: 'Tankōbon Full Color',
    trimSize: 'tankobon',
    trimLabel: 'Tankōbon (128×182mm)',
    dimensionsMm: { width: 128, height: 182 },
    dimensionsIn: { width: 5.04, height: 7.17 },
    colorInterior: 'FC',
    bindingType: 'PERFECT',
    paperWeight: '060',
    luluPackageId: '0504X0717FCPERFECT060UW444',
    basePriceCents: 1099, // $10.99 base
    perPageCents: 6,
    minPages: 24,
    maxPages: 800,
    creatorRoyaltyRate: 0.15,
    platformMarginRate: 0.20,
    isDefault: false,
    description: 'Classic Japanese manga paperback size. Authentic tankōbon experience.',
  },
  {
    id: 'us-trade-color-perfect',
    name: 'US Trade Paperback',
    trimSize: 'us_trade',
    trimLabel: 'US Trade (152×229mm)',
    dimensionsMm: { width: 152, height: 229 },
    dimensionsIn: { width: 6.00, height: 9.00 },
    colorInterior: 'FC',
    bindingType: 'PERFECT',
    paperWeight: '060',
    luluPackageId: '0600X0900FCPERFECT060UW444',
    basePriceCents: 1399, // $13.99 base
    perPageCents: 7,
    minPages: 24,
    maxPages: 800,
    creatorRoyaltyRate: 0.15,
    platformMarginRate: 0.20,
    isDefault: false,
    description: 'Standard US graphic novel format. Familiar to Western readers.',
  },
  // B&W variants (lower cost)
  {
    id: 'b5-bw-perfect',
    name: 'B5 Black & White',
    trimSize: 'b5',
    trimLabel: 'B5 (176×250mm)',
    dimensionsMm: { width: 176, height: 250 },
    dimensionsIn: { width: 6.93, height: 9.84 },
    colorInterior: 'BW',
    bindingType: 'PERFECT',
    paperWeight: '060',
    luluPackageId: '0693X0984BWPERFECT060UW444',
    basePriceCents: 999, // $9.99 base
    perPageCents: 4, // $0.04 per page
    minPages: 24,
    maxPages: 800,
    creatorRoyaltyRate: 0.15,
    platformMarginRate: 0.20,
    isDefault: false,
    description: 'Traditional manga B&W format. Lower cost, authentic look for ink-style art.',
  },
  {
    id: 'tankobon-bw-perfect',
    name: 'Tankōbon Black & White',
    trimSize: 'tankobon',
    trimLabel: 'Tankōbon (128×182mm)',
    dimensionsMm: { width: 128, height: 182 },
    dimensionsIn: { width: 5.04, height: 7.17 },
    colorInterior: 'BW',
    bindingType: 'PERFECT',
    paperWeight: '060',
    luluPackageId: '0504X0717BWPERFECT060UW444',
    basePriceCents: 799, // $7.99 base
    perPageCents: 3,
    minPages: 24,
    maxPages: 800,
    creatorRoyaltyRate: 0.15,
    platformMarginRate: 0.20,
    isDefault: false,
    description: 'Classic B&W tankōbon. Most affordable print option.',
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Get the default print product (B5 full color perfect-bound).
 */
export function getDefaultProduct(): PrintProduct {
  return PRINT_PRODUCTS.find(p => p.isDefault)!;
}

/**
 * Get a product by its ID.
 */
export function getProductById(id: string): PrintProduct | undefined {
  return PRINT_PRODUCTS.find(p => p.id === id);
}

/**
 * Get all products for a given trim size.
 */
export function getProductsByTrimSize(trimSize: TrimSize): PrintProduct[] {
  return PRINT_PRODUCTS.filter(p => p.trimSize === trimSize);
}

/**
 * Calculate the total price for a print order.
 */
export function calculateOrderPrice(
  product: PrintProduct,
  pageCount: number,
  quantity: number = 1
): {
  unitPriceCents: number;
  totalPriceCents: number;
  printCostCents: number;
  platformMarginCents: number;
  creatorRoyaltyCents: number;
} {
  const unitPriceCents = product.basePriceCents + (pageCount * product.perPageCents);
  const totalPriceCents = unitPriceCents * quantity;

  // Revenue split: Lulu cost is ~60% of our base, rest is margin + creator royalty
  const estimatedLuluCost = Math.round(unitPriceCents * 0.65); // ~65% goes to Lulu printing
  const revenue = unitPriceCents - estimatedLuluCost;
  const platformMarginCents = Math.round(revenue * product.platformMarginRate);
  const creatorRoyaltyCents = Math.round(revenue * product.creatorRoyaltyRate);

  return {
    unitPriceCents,
    totalPriceCents,
    printCostCents: estimatedLuluCost * quantity,
    platformMarginCents: platformMarginCents * quantity,
    creatorRoyaltyCents: creatorRoyaltyCents * quantity,
  };
}

/**
 * Validate page count for a product.
 */
export function validatePageCount(product: PrintProduct, pageCount: number): {
  valid: boolean;
  error?: string;
} {
  if (pageCount < product.minPages) {
    return { valid: false, error: `Minimum ${product.minPages} pages required for ${product.name}` };
  }
  if (pageCount > product.maxPages) {
    return { valid: false, error: `Maximum ${product.maxPages} pages allowed for ${product.name}` };
  }
  return { valid: true };
}

/**
 * Get available shipping methods with estimated delivery times.
 */
export function getShippingOptions(): Array<{
  method: 'MAIL' | 'GROUND' | 'EXPEDITED' | 'EXPRESS';
  label: string;
  estimatedDays: string;
  baseCostCents: number;
}> {
  return [
    { method: 'MAIL', label: 'Standard Mail', estimatedDays: '10-20 business days', baseCostCents: 499 },
    { method: 'GROUND', label: 'Ground Shipping', estimatedDays: '5-10 business days', baseCostCents: 799 },
    { method: 'EXPEDITED', label: 'Expedited', estimatedDays: '3-5 business days', baseCostCents: 1499 },
    { method: 'EXPRESS', label: 'Express', estimatedDays: '1-3 business days', baseCostCents: 2499 },
  ];
}
