
"use client";

import React, { createContext, useState, useContext, ReactNode, useEffect, useMemo } from 'react';

type CurrencyCode = 'INR' | 'USD' | 'GBP' | 'EUR';

type CurrencyInfo = {
    symbol: string;
    label: string;
};

export const currencyOptions: Record<CurrencyCode, CurrencyInfo> = {
    'INR': { symbol: '₹', label: 'Indian Rupee (INR)' },
    'USD': { symbol: '$', label: 'US Dollar (USD)' },
    'GBP': { symbol: '£', label: 'British Pound (GBP)' },
    'EUR': { symbol: '€', label: 'Euro (EUR)' },
};

interface CurrencyContextType {
  currency: CurrencyCode;
  setCurrency: (currency: string) => void;
  currencySymbol: string;
  currencyOptions: Record<CurrencyCode, CurrencyInfo>;
}

const CurrencyContext = createContext<CurrencyContextType | undefined>(undefined);

export const CurrencyProvider = ({ children }: { children: ReactNode }) => {
  const [currency, setCurrencyState] = useState<CurrencyCode>(() => {
    const storedCurrency = localStorage.getItem('app-currency') as CurrencyCode;
    return storedCurrency && currencyOptions[storedCurrency] ? storedCurrency : 'INR';
  });

  const setCurrency = (newCurrency: string) => {
    const currencyCode = newCurrency as CurrencyCode;
    if (currencyOptions[currencyCode]) {
      setCurrencyState(currencyCode);
      localStorage.setItem('app-currency', currencyCode);
    }
  };

  const currencySymbol = useMemo(
    () => currencyOptions[currency]?.symbol || '₹',
    [currency]
  );

  return (
    <CurrencyContext.Provider value={{ currency, setCurrency, currencySymbol, currencyOptions }}>
      {children}
    </CurrencyContext.Provider>
  );
};


export const useCurrency = () => {
  const context = useContext(CurrencyContext);
  if (context === undefined) {
    throw new Error('useCurrency must be used within a CurrencyProvider');
  }
  return context;
};
