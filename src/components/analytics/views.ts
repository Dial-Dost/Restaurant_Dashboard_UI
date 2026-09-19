// The analytics view filter ("show only this slice") — the web copy of the
// Flutter `_analyticsViews` / `_kpiHomeView` / `_overviewKpis` tables
// (restaurant_owner_app modules.dart ~19923). Each section/KPI is tagged into
// exactly one detail view; 'overview' is a curated headline cut and
// 'everything' shows all.

export type ViewId =
    | 'overview'
    | 'sales'
    | 'discounts'
    | 'menu'
    | 'staff'
    | 'customers'
    | 'operations'
    | 'kitchen'
    | 'supply'
    | 'marketing'
    | 'everything';

export const ANALYTICS_VIEWS: { id: ViewId; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'sales', label: 'Sales & Revenue' },
    { id: 'discounts', label: 'Discounts & Offers' },
    { id: 'menu', label: 'Menu' },
    { id: 'staff', label: 'Staff' },
    { id: 'customers', label: 'Customers' },
    { id: 'operations', label: 'Operations' },
    // Kitchen is its own first-class slice (prep timing per station and per
    // dish), and its headline also rides along on Overview.
    { id: 'kitchen', label: 'Kitchen' },
    { id: 'supply', label: 'Suppliers & Inventory' },
    { id: 'marketing', label: 'Marketing' },
    { id: 'everything', label: 'Everything' },
];

export const viewLabel = (id: string): string =>
    ANALYTICS_VIEWS.find((v) => v.id === id)?.label ?? id;

/** Home view per KPI key (exactly one each). */
export const KPI_HOME_VIEW: Record<string, ViewId> = {
    revpash: 'sales',
    profit_margin: 'sales',
    discount_utilization: 'discounts',
    offer_redemption: 'discounts',
    menu_bad_share: 'menu',
    forecast_mape: 'menu',
    labour_cost: 'staff',
    happiness_efficiency: 'staff',
    avg_rating: 'customers',
    nps: 'customers',
    complaint_rate: 'customers',
    churn_rate: 'customers',
    wait_time: 'operations',
    table_turnaround: 'operations',
    processing_time: 'kitchen',
    booking_fill: 'operations',
    booking_no_show: 'operations',
    valet_retrieval: 'operations',
    supplier_on_time: 'supply',
    supplier_score: 'supply',
    low_stock: 'supply',
    food_cost_pct: 'supply',
    food_cost_variance: 'supply',
    campaign_roi: 'marketing',
};

/** Headline KPIs shown on the Overview view. */
export const OVERVIEW_KPIS = new Set<string>([
    'profit_margin', 'revpash', 'food_cost_pct', 'labour_cost',
    'avg_rating', 'nps', 'table_turnaround', 'churn_rate', 'low_stock',
]);
