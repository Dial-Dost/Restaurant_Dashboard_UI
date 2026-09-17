// CLIENT ITEM 6 (app 2.0.2) — "Search tables..." in Add New Order picked the
// wrong table.
//
// cmdk's own filter scores an item by `${value} ${keywords.join(' ')}`. The
// shared Combobox gives each row its option's value (a table's uuid, a dish's
// lower-cased name) and its label as the only keyword. So a table was scored
// on its uuid as well as its name, and uuids are full of digits. At Gaia and
// Gaia Global Vegetarian, where every table is a number, "4" matched every
// table, and "12" put 16 above 12. cmdk highlights the best score and Enter
// takes it, so typing a table's exact name and pressing Enter could put the
// order on another table. Scored against the production names (read-only,
// 2026-09-17), that was five tables at Gaia, two at GGV and five or more at
// CSR Organics; scored on the label alone, none.
//
// A row is scored on the words on it, and only on those.

import { defaultFilter } from 'cmdk';

/**
 * The Combobox's cmdk `filter`: the row's keywords (its label), or its value
 * when it has none. Selecting still hands back the value.
 */
export const scoreComboboxRow = (value: string, search: string, keywords?: string[]): number =>
    defaultFilter((keywords ?? []).join(' ').trim() || value, search);
