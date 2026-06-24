// Friendly, customer-facing pick list mapped to specific Zamp product tax codes.
// Zamp exposes 147 codes; we expose a small, understandable subset. This is also
// the server-side ALLOWLIST — the proxy refuses any code not in this list, so the
// endpoint can't be abused as a free general-purpose tax API.

export interface TaxCodeOption {
  /** stable slug used in the API + widget */
  id: string;
  /** label shown to visitors */
  label: string;
  /** the underlying Zamp productTaxCode */
  zampCode: string;
  /** optional caveat shown under the result */
  note?: string;
}

export const TAX_CODES: TaxCodeOption[] = [
  { id: 'general', label: 'General goods', zampCode: 'R_TPP' },
  {
    id: 'clothing',
    label: 'Clothing',
    zampCode: 'R_TPP_APPAREL_CLOTHING',
    note: 'Some states exempt clothing entirely or only above a price threshold (e.g. MA exempts items up to $175, taxing only the amount over), so the tax can change with the price. Accessories and athletic gear follow separate rules.',
  },
  {
    id: 'groceries',
    label: 'Groceries (food for home)',
    zampCode: 'Z-FBV000',
    note: 'Many states exempt grocery food or apply a reduced rate.',
  },
  { id: 'prepared-food', label: 'Prepared food / restaurant', zampCode: 'Z-FBV400' },
  { id: 'candy', label: 'Candy', zampCode: 'Z-FBV200' },
  { id: 'digital', label: 'Digital products', zampCode: 'Z-DIG000' },
  { id: 'saas', label: 'Software (SaaS)', zampCode: 'Z-DIG540' },
  { id: 'services', label: 'Professional services', zampCode: 'R_SRV_PROFESSIONAL' },
];

const byId = new Map(TAX_CODES.map((t) => [t.id, t]));

export function resolveTaxCode(id: string): TaxCodeOption | undefined {
  return byId.get(id);
}

/** Lightweight list for the widget / public tax-codes endpoint (no Zamp codes leaked). */
export function publicTaxCodes() {
  return TAX_CODES.map(({ id, label, note }) => ({ id, label, note: note ?? null }));
}
