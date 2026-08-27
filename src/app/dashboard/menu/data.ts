
// One recipe row: inventory ingredient consumed per unit sold (+ optional note,
// e.g. "grams" or "chopped").
export interface RecipeIngredient { inventory_id: string; qty: number; note?: string }

export interface MenuItem {
  id: string;
  name: string;
  price: number;
  category: string;
  image_url?: string | null;
  available?: boolean;
  recipe?: RecipeIngredient[];
  // Prep station that cooks this dish (KOT routing), e.g. "tandoor" / "grill".
  station?: string | null;
  // Allergen tags shown to guests on the QR menu, e.g. ["gluten", "nuts"].
  allergens?: string[];
  /**
   * Human description of the dish ("a few lines"), shown to guests when they open
   * the item on the QR order page. Stored server-side as the `blurb` key INSIDE
   * the Menu.description JSON blob (never as its own column) and capped at 500
   * characters. Semantics on write: omitted => keep what is stored, "" => clear.
   */
  blurb?: string;
  /**
   * Configurable badge TAGS: ids into the restaurant's badge catalogue
   * ("Must Try", "Jain"...). Stored server-side as the `badges` key inside the
   * Menu.description JSON blob, like every other item extra. Omitted on write =
   * keep the stored tags, [] = clear them. Allergen-derived safety badges are
   * NOT listed here — they come from `allergens` (see lib/menu-badges.ts).
   */
  badges?: string[];
}

export const initialMenuItems: MenuItem[] = [
  { id: "1", name: "Garlic Bread", price: 6.5, category: "Appetizers" },
  { id: "2", name: "Bruschetta", price: 8.0, category: "Appetizers" },
  { id: "3", name: "Margherita Pizza", price: 14.0, category: "Main Courses" },
  { id: "4", name: "Spaghetti Carbonara", price: 16.5, category: "Main Courses" },
  { id: "5", name: "Tiramisu", price: 7.0, category: "Desserts" },
  { id: "6", name: "Panna Cotta", price: 7.0, category: "Desserts" },
  { id: "7", name: "House Red Wine", price: 8.0, category: "Beverages" },
  { id: "8", name: "Sparkling Water", price: 3.0, category: "Beverages" },
];
