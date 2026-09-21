import type {Config} from 'tailwindcss';
import colors from 'tailwindcss/colors';
import plugin from 'tailwindcss/plugin';

export default {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      // THE TWO BREAKPOINTS TAILWIND DOES NOT SHIP, added rather than
      // renaming the defaults — 76 source files already use sm/md/lg/xl.
      //   xs   360px  a real phone, as opposed to the 320px floor the base
      //                rules are written for (iPhone SE, Z Fold cover at 344)
      //   fold 600px  a foldable opened (Z Fold is 717) or a phablet: wider
      //                than a phone, far narrower than the 768px iPad, and
      //                without this stop it inherits one of the two badly
      // docs/responsive.md carries the table and the reasoning.
      screens: {
        xs: '360px',
        fold: '600px',
      },
      fontSize: {
        // Fluid steps — see docs/responsive.md. Each clamps between its 320px
        // and 1440px size, so type never jumps at a breakpoint.
        fluidXs: ['var(--fs-xs)', { lineHeight: '1.35' }],
        fluidSm: ['var(--fs-sm)', { lineHeight: '1.45' }],
        fluidBase: ['var(--fs-base)', { lineHeight: '1.55' }],
        fluidLg: ['var(--fs-lg)', { lineHeight: '1.4' }],
        fluidXl: ['var(--fs-xl)', { lineHeight: '1.3' }],
        fluid2xl: ['var(--fs-2xl)', { lineHeight: '1.2' }],
        money: ['var(--fs-money)', { lineHeight: '1.1' }],
      },
      fontFamily: {
        // next/font registers a hashed family behind this variable; the bare
        // string "Inter" only resolved inside the dashboard shell, which
        // carries inter.className directly.
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        // Gaia's serif — figures and names only, never body copy.
        serif: ['var(--font-cormorant)', 'Georgia', 'serif'],
        code: ['monospace'],
      },
      colors: {
        // Experio landing palette (src/components/experio/*). Purely additive:
        // `emerald`/`violet` spread the default scales first so existing
        // numbered utilities (e.g. emerald-600) keep working.
        ink: { DEFAULT: '#111111', '2': '#666666', '3': '#74746d' },
        gold: { DEFAULT: '#d4af37', '2': '#e8c75d', deep: '#a8862a' },
        azure: '#3e7bfa',
        emerald: { ...colors.emerald, DEFAULT: '#0fa678' },
        violet: { ...colors.violet, DEFAULT: '#7c5cfc' },
        background: 'hsl(var(--background))',
        'background-deep': 'hsl(var(--background-deep))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
          top: 'hsl(var(--card-top))',
          bottom: 'hsl(var(--card-bottom))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
          // The 5-stop accent ramp (AppColors.copperRamp) + the ink dark
          // enough to sit on an accent-filled control.
          hi: 'hsl(var(--accent-hi))',
          base: 'hsl(var(--accent-base))',
          mid: 'hsl(var(--accent-mid))',
          deep: 'hsl(var(--accent-deep))',
          shadow: 'hsl(var(--accent-shadow))',
          on: 'hsl(var(--accent-on))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        // Status inks — never colour-alone; the shared StatusChip pairs them
        // with a label and a dot.
        success: 'hsl(var(--success))',
        warning: 'hsl(var(--warning))',
        info: 'hsl(var(--info))',
        neutral: 'hsl(var(--neutral))',
        // The third ink weight (text-tertiary), and the app's extra grounds.
        tertiary: 'hsl(var(--text-tertiary))',
        inset: 'hsl(var(--inset))',
        divider: 'hsl(var(--divider))',
        glow: {
          bright: 'hsl(var(--glow-bright))',
          mid: 'hsl(var(--glow-mid))',
          deep: 'hsl(var(--glow-deep))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        chart: {
          '1': 'hsl(var(--chart-1))',
          '2': 'hsl(var(--chart-2))',
          '3': 'hsl(var(--chart-3))',
          '4': 'hsl(var(--chart-4))',
          '5': 'hsl(var(--chart-5))',
        },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar-background))',
          foreground: 'hsl(var(--sidebar-foreground))',
          primary: 'hsl(var(--sidebar-primary))',
          'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
          accent: 'hsl(var(--sidebar-accent))',
          'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
          border: 'hsl(var(--sidebar-border))',
          ring: 'hsl(var(--sidebar-ring))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      boxShadow: {
        // ForkCard's ambient shadow: resting / hovered; `none` under Gaia.
        card: 'var(--shadow-card)',
        'card-hover': 'var(--shadow-card-hover)',
      },
      transitionDuration: {
        // AppDurations: fast 140, base 220, slow 350.
        fast: '140ms',
        base: '220ms',
        slow: '350ms',
      },
      keyframes: {
        'accordion-down': {
          from: {
            height: '0',
          },
          to: {
            height: 'var(--radix-accordion-content-height)',
          },
        },
        'accordion-up': {
          from: {
            height: 'var(--radix-accordion-content-height)',
          },
          to: {
            height: '0',
          },
        },
        // SkeletonBox's opacity pulse (skeleton.dart: 0.45 -> 1.0, 1100ms,
        // easeInOut, reversing).
        'skeleton-pulse': {
          '0%, 100%': { opacity: '0.45' },
          '50%': { opacity: '1' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'skeleton-pulse': 'skeleton-pulse 2.2s ease-in-out infinite',
      },
    },
  },
  plugins: [
    require('tailwindcss-animate'),
    // `gaia:` — styles that only apply while the Gaia design system is worn.
    // The shape/type overrides live in the shared components, not per page.
    plugin(({ addVariant }) => {
      addVariant('gaia', '[data-palette="gaia"] &');
    }),
  ],
} satisfies Config;
