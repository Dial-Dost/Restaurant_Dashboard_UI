"use client";

/*
  THE RESTAURANT'S PAYMENT MODES, FOR A SCREEN THAT TAKES MONEY.

  One read of GET /restaurant/settings `payment_methods`, shared by the Orders
  settle submenu, the split dialog, the tender form and the closed-bills filter,
  so a mode an owner adds in Settings > Payment modes reaches every picker the
  same afternoon — and none of them keeps a list of its own to drift again.

  STARTS AS THE DEFAULTS AND STAYS THERE IF THE READ FAILS. A settle must never
  be blocked because a settings document could not be fetched, and the defaults
  are exactly what the server settles with for a restaurant that never opened the
  editor. The editor itself does NOT use this: it must never show an owner a list
  that is not theirs (see getPaymentMethods).
*/

import { useCallback, useEffect, useState } from "react";

import { getPaymentMethods } from "@/lib/db";
import { DEFAULT_PAYMENT_METHODS, type PaymentMethodConfig } from "@/lib/payment-methods";

export function usePaymentMethods(restaurantId: string | null | undefined): {
  methods: PaymentMethodConfig[];
  loaded: boolean;
  reload: () => void;
} {
  const [methods, setMethods] = useState<PaymentMethodConfig[]>(() => DEFAULT_PAYMENT_METHODS.map((m) => ({ ...m })));
  const [loaded, setLoaded] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!restaurantId) {return;}
    let active = true;
    getPaymentMethods(restaurantId)
      .then((next) => { if (active) {setMethods(next);} })
      .catch(() => {/* keep the defaults — see the header */})
      .finally(() => { if (active) {setLoaded(true);} });
    return () => { active = false; };
  }, [restaurantId, tick]);

  const reload = useCallback(() => { setTick((t) => t + 1); }, []);
  return { methods, loaded, reload };
}
