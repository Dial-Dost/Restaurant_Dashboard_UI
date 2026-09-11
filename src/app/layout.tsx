
import type {Metadata} from 'next';
import { Alegreya, Inter } from 'next/font/google';
import './globals.css';
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from '@/components/ThemeProvider';
import { LanguageProvider } from '@/context/LanguageContext';
import { AuthProvider } from '@/context/AuthContext';
import { CurrencyProvider } from '@/hooks/use-currency';

const alegreya = Alegreya({
  subsets: ['latin'],
  variable: '--font-alegreya',
});

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'CuisineFlow',
  description: 'Streamline Your Restaurant Management',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning data-scroll-behavior="smooth" className={`${alegreya.variable} ${inter.variable}`}>
      <body className="font-sans antialiased">
        {/*
          DARK BY DEFAULT, AND THE LIGHT TOGGLE STAYS.

          The Flutter app the web is being brought into line with is a dark
          copper-on-charcoal product, and a restaurant screen lives in a dim
          room all evening; a white page is the wrong default for the people
          actually standing in front of it.

          This only moves the default. `next-themes` stores an explicit choice,
          so anybody who has already picked light keeps light — the change is
          for a session that has never expressed a preference, which is every
          new device.

          `enableSystem` stays FALSE on purpose. A restaurant's tablets and the
          owner's laptop would otherwise disagree about the product's colour
          depending on each device's OS setting, and "why does it look different
          on the till" is not a question worth creating.
        */}
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          <AuthProvider>
            <LanguageProvider>
              <CurrencyProvider>
                {children}
                <Toaster />
              </CurrencyProvider>
            </LanguageProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
