/**
 * Canonical merchant-category ontology for the BTCMap surface.
 *
 * Single source of truth for the icon → category → marker-colour mapping
 * shared by MapScreen (filter buttons), MerchantDetailScreen (detail tint),
 * and mapClustering (cluster pin colours). Adding a merchant icon requires
 * one edit here; previously took three edits across drifting tables.
 */

import { BITCOIN_ACCENT } from '@/shared/lib/brandColors';

export type MerchantCategoryId = 'food' | 'retail' | 'atm' | 'accommodation' | 'services';

export interface MerchantCategory {
  readonly id: MerchantCategoryId;
  readonly label: string;
  readonly icons: readonly string[];
  readonly markerColor: string;
}

export const MERCHANT_CATEGORIES: readonly MerchantCategory[] = [
  {
    id: 'food',
    label: 'Food & Drink',
    icons: ['local_cafe', 'lunch_dining', 'restaurant', 'bakery_dining'],
    markerColor: '#FF6B6B',
  },
  {
    id: 'retail',
    label: 'Retail & Shopping',
    icons: ['storefront', 'local_grocery_store', 'computer', 'diamond'],
    markerColor: '#4ECDC4',
  },
  {
    id: 'atm',
    label: 'ATMs & Exchange',
    icons: ['local_atm', 'currency_exchange'],
    markerColor: BITCOIN_ACCENT,
  },
  {
    id: 'accommodation',
    label: 'Accommodation',
    icons: ['hotel', 'spa'],
    markerColor: '#9B59B6',
  },
  {
    id: 'services',
    label: 'Services',
    icons: [
      'medical_services',
      'local_pharmacy',
      'content_cut',
      'car_repair',
      'fitness_center',
      'business',
    ],
    markerColor: '#3498DB',
  },
];

const DEFAULT_MARKER_COLOR = '#6366f1';
export const CLUSTER_MARKER_COLOR = BITCOIN_ACCENT;

const ICON_TO_CATEGORY: ReadonlyMap<string, MerchantCategory> = new Map(
  MERCHANT_CATEGORIES.flatMap((cat) => cat.icons.map((icon) => [icon, cat] as const))
);

export function getMarkerColor(icon: string): string {
  return ICON_TO_CATEGORY.get(icon)?.markerColor ?? DEFAULT_MARKER_COLOR;
}

export function getIconsForCategory(id: MerchantCategoryId): readonly string[] {
  return MERCHANT_CATEGORIES.find((c) => c.id === id)?.icons ?? [];
}
