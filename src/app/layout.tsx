
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
      <head>
        {/*
          THE PALETTE GOES ON <html> BEFORE THE FIRST PAINT.

          Without this the page renders one palette and swaps to another the
          moment React hydrates — the same flash-of-wrong-theme `next-themes`
          runs its own inline script to avoid. It has to be inline and
          blocking; a `useEffect` is by definition after the paint.

          It is deliberately tiny and deliberately total: ANY failure — no
          storage, a blocked cookie jar, a value this build does not know —
          lands on the default rather than leaving the attribute unset, because
          an unset attribute leaves every token at its `:root` value, which is
          the LIGHT palette, and a white dashboard in a dark room reads as a
          broken toggle.

          The literals are duplicated from src/lib/palette.ts because this
          string cannot import; a test pins the two against each other.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var v=localStorage.getItem('cuisineflow-palette');"
              + "if(v!=='rustic'&&v!=='gaia'){v='rustic';}"
              + "document.documentElement.setAttribute('data-palette',v);}"
              + "catch(e){document.documentElement.setAttribute('data-palette','rustic');}})();",
          }}
        />
        {/*
          6.6 — THE LIGHT-MODE TONE (white / beige / grey), same reasoning as
          above: before first paint, or a beige user sees a white flash. Its own
          try so a failure here can never cost the palette its attribute.
          Literals duplicated from src/lib/light-tone.ts; pinned by its test.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('cuisineflow-light-tone');"
              + "if(t!=='white'&&t!=='beige'&&t!=='grey'){t='white';}"
              + "document.documentElement.setAttribute('data-light-tone',t);}"
              + "catch(e){document.documentElement.setAttribute('data-light-tone','white');}})();",
          }}
        />
      </head>
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
