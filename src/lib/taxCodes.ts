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
  // ---- general & retail / ecommerce ----
  { id: 'general', label: 'General goods', zampCode: 'R_TPP' },
  {
    id: 'clothing',
    label: 'Clothing',
    zampCode: 'R_TPP_APPAREL_CLOTHING',
    note: 'Some states exempt clothing entirely or only above a price threshold (e.g. MA exempts items up to $175, taxing only the amount over), so the tax can change with the price. Accessories and athletic gear follow separate rules.',
  },
  {
    id: 'accessories',
    label: 'Apparel accessories',
    zampCode: 'R_TPP_APPAREL_ACCESSORIES',
    note: 'Accessories like jewelry and handbags are usually taxed even in states that exempt clothing.',
  },
  { id: 'cosmetics', label: 'Cosmetics & personal care', zampCode: 'R_TPP_PERSONAL-CARE' },
  {
    id: 'feminine-hygiene',
    label: 'Feminine hygiene products',
    zampCode: 'R_TPP_PERSONAL-CARE_FEMININE-HYGIENE',
    note: 'A growing number of states exempt menstrual products from sales tax.',
  },
  {
    id: 'prescription',
    label: 'Prescription drugs',
    zampCode: 'R_TPP_DRUGS_PRESCRIPTION',
    note: 'Prescription medication is exempt in almost every state.',
  },
  {
    id: 'otc',
    label: 'Over-the-counter medicine',
    zampCode: 'R_TPP_DRUGS',
    note: 'OTC medicine is taxed in some states and exempt in others.',
  },
  { id: 'pet-food', label: 'Pet food', zampCode: 'R_TPP_PET-SUPPLIES_PET-FOOD' },
  // ---- digital products ----
  {
    id: 'digital',
    label: 'Digital products',
    zampCode: 'Z-DIG000',
    note: 'Digital goods are taxed in some states and exempt in others.',
  },
  {
    id: 'software',
    label: 'Downloaded software',
    zampCode: 'Z-DIG600',
    note: 'Prewritten software downloaded electronically; taxability varies by state.',
  },
  {
    id: 'saas',
    label: 'Software (SaaS)',
    zampCode: 'Z-DIG540',
    note: 'The taxability of software-as-a-service varies widely by state.',
  },
  {
    id: 'streaming',
    label: 'Streaming subscription',
    zampCode: 'Z-DIG515',
    note: 'Streaming services are increasingly taxed, but not everywhere.',
  },
  { id: 'ebooks', label: 'eBooks', zampCode: 'Z-DIG110', note: 'Digital book taxability varies by state.' },
  // ---- food & beverage ----
  {
    id: 'groceries',
    label: 'Groceries (food for home)',
    zampCode: 'Z-FBV000',
    note: 'Most states exempt grocery food or apply a reduced rate.',
  },
  { id: 'prepared-food', label: 'Prepared food / restaurant', zampCode: 'Z-FBV400' },
  {
    id: 'candy',
    label: 'Candy',
    zampCode: 'Z-FBV200',
    note: 'Several states tax candy even when groceries are exempt.',
  },
  {
    id: 'snacks',
    label: 'Snack food',
    zampCode: 'Z-FBV205',
    note: 'Often treated as grocery food and exempt, but not always.',
  },
  {
    id: 'soda',
    label: 'Soft drinks / soda',
    zampCode: 'Z-FBV100',
    note: 'Soft drinks are commonly taxed even where groceries are exempt.',
  },
  {
    id: 'water',
    label: 'Bottled water',
    zampCode: 'Z-FBV125',
    note: 'Bottled water is exempt in most states but taxed in some.',
  },
  { id: 'juice', label: 'Juice', zampCode: 'Z-FBV135', note: 'High-juice-content drinks are often exempt as food.' },
  {
    id: 'supplements',
    label: 'Vitamins & supplements',
    zampCode: 'Z-FBV300',
    note: 'Dietary supplements are taxed in some states and exempt in others.',
  },
  // ---- services ----
  {
    id: 'services',
    label: 'Professional services',
    zampCode: 'R_SRV_PROFESSIONAL',
    note: "Most states don't tax professional services.",
  },
];

const byId = new Map(TAX_CODES.map((t) => [t.id, t]));

export function resolveTaxCode(id: string): TaxCodeOption | undefined {
  return byId.get(id);
}

/** Lightweight list for the widget / public tax-codes endpoint (no Zamp codes leaked). */
export function publicTaxCodes() {
  return TAX_CODES.map(({ id, label, note }) => ({ id, label, note: note ?? null }));
}
