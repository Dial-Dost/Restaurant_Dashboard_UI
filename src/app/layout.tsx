
import type {Metadata, Viewport} from 'next';
import { Cormorant_Garamond, Instrument_Sans, Inter } from 'next/font/google';
import './globals.css';
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from '@/components/ThemeProvider';
import { LanguageProvider } from '@/context/LanguageContext';
import { AuthProvider } from '@/context/AuthContext';
import { CurrencyProvider } from '@/hooks/use-currency';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
});

/* GAIA'S TWO FACES (gaia_type.dart): Cormorant Garamond carries figures and
   names, Instrument Sans carries labels. Registered as variables and consumed
   only under [data-palette="gaia"] (globals.css), so a Rustic session never
   downloads them — a @font-face fetches when text actually uses it. */
const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-cormorant',
});

const instrumentSans = Instrument_Sans({
  subsets: ['latin'],
  variable: '--font-instrument',
});

export const metadata: Metadata = {
  title: 'CuisineFlow',
  description: 'Streamline Your Restaurant Management',
};

/**
 * THE VIEWPORT, stated rather than defaulted (docs/responsive.md §5).
 *
 * `viewport-fit=cover` lets the page paint under a notch and the home bar; the
 * shell pads itself back out with env(safe-area-inset-*) in globals.css. Next's
 * default omits it, so on an iPhone the bottom bar sat over the last row.
 *
 * NO `maximum-scale` and NO `user-scalable: false`. Pinch-zoom is how a
 * partially sighted cashier reads a total, and iOS ignores the ban anyway since
 * 10 — all it does is fail an accessibility audit. Fields are pinned to 16px
 * below `sm` instead, which is what actually stops Safari auto-zooming.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>): React.JSX.Element {
  return (
    <html lang="en" suppressHydrationWarning data-scroll-behavior="smooth" className={`${inter.variable} ${cormorant.variable} ${instrumentSans.variable}`}>
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
        {/*
          THE APPEARANCE AXES (accent ramp + shell scheme), same reasoning as
          the palette above: before first paint, or a sage-on-midnight till
          flashes copper-on-rustic. Own try/catch; any failure lands on
          copper/rustic — the shipped defaults, which is what every device
          starts as. And while GAIA is worn the `dark` class is forced on
          before paint, because Gaia has no light variant (a picked light tone
          is remembered, not applied — appearance.dart lightActive) and the
          tokens paint dark whatever the class says; keeping the class aligned
          keeps `dark:` utilities agreeing with the tokens.
          Literals duplicated from src/lib/appearance.ts; pinned by its test.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){var d=document.documentElement;"
              + "try{var a=localStorage.getItem('cuisineflow-accent');"
              + "if(['copper','brass','sage','teal','steel','lavender','rose','ember'].indexOf(a)<0){a='copper';}"
              + "d.setAttribute('data-accent',a);}catch(e){d.setAttribute('data-accent','copper');}"
              + "try{var s=localStorage.getItem('cuisineflow-scheme');"
              + "if(['rustic','slate','charcoal','midnight','graphite'].indexOf(s)<0){s='rustic';}"
              + "d.setAttribute('data-scheme',s);}catch(e){d.setAttribute('data-scheme','rustic');}"
              + "try{if(d.getAttribute('data-palette')==='gaia'){d.classList.add('dark');}}catch(e){}})();",
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
