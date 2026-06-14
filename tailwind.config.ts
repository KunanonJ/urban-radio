import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: [
    "./src/**/*.{ts,tsx,mdx}",
    "./node_modules/@tremor/**/*.{js,ts,jsx,tsx}",
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        "neon-green": "hsl(var(--neon-green))",
        "neon-cyan": "hsl(var(--neon-cyan))",
        "neon-violet": "hsl(var(--neon-violet))",
        "neon-amber": "hsl(var(--neon-amber))",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      // Additive box-shadow tokens for layered elevation. Subtle, dark-mode
      // friendly — combine with `.surface-*-bordered` for the Linear/Vercel
      // "borders not shadows" look, or use standalone for floating surfaces.
      boxShadow: {
        "elevation-1":
          "0 1px 2px 0 hsl(0 0% 0% / 0.18), 0 1px 1px -1px hsl(0 0% 0% / 0.14)",
        "elevation-2":
          "0 4px 12px -2px hsl(0 0% 0% / 0.28), 0 2px 4px -2px hsl(0 0% 0% / 0.18)",
        "elevation-3":
          "0 12px 32px -6px hsl(0 0% 0% / 0.42), 0 4px 12px -4px hsl(0 0% 0% / 0.24)",
      },
      // Additive gradient tokens. Available as `bg-gradient-radial` /
      // `bg-gradient-glow` Tailwind utilities.
      backgroundImage: {
        "gradient-radial":
          "radial-gradient(ellipse at top, hsl(var(--primary) / 0.18), transparent 70%)",
        "gradient-glow":
          "radial-gradient(circle at center, hsl(var(--primary) / 0.28), hsl(var(--primary) / 0) 60%)",
      },
      // Semantic font-size tokens — drive `.text-display`/`.text-heading`/...
      // via CSS but expose the raw scale to Tailwind too (no conflicts: keys
      // are namespaced under `display`/`heading`/`body`/`mono-sm`).
      fontSize: {
        display: ["var(--text-3xl)", { lineHeight: "var(--leading-display)" }],
        heading: ["var(--text-xl)", { lineHeight: "var(--leading-heading)" }],
        body: ["var(--text-base)", { lineHeight: "var(--leading-body)" }],
        "mono-sm": ["var(--text-sm)", { lineHeight: "var(--leading-mono)" }],
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "pulse-glow": {
          "0%, 100%": { opacity: "0.4" },
          "50%": { opacity: "1" },
        },
        "slide-up": {
          from: { transform: "translateY(10px)", opacity: "0" },
          to: { transform: "translateY(0)", opacity: "1" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "pulse-glow": "pulse-glow 2s ease-in-out infinite",
        "slide-up": "slide-up 0.4s ease-out",
        "fade-in": "fade-in 0.3s ease-out",
      },
    },
  },
  plugins: [tailwindcssAnimate],
} satisfies Config;
