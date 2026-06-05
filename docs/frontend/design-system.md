# Design System

> **Status:** Draft v0.1 · **Phase:** cross-cutting (Phases 0–4) · **Owner area:** frontend
> **Related:** [charts.md](charts.md), [best-practices.md](best-practices.md), [mobile.md](mobile.md), [state-and-forms.md](state-and-forms.md), [../SCOPE.md](../SCOPE.md), [../README.md](../README.md)

This document is the single source of truth for **all visual decisions** in Stabil's web (`apps/web` — Next.js 15 + Tailwind + shadcn/ui) and mobile (`apps/mobile` — Expo/React Native + NativeWind) surfaces. It covers design tokens, theming, the shadcn/ui component inventory and how Stabil wraps each component, five Stabil-specific components with TypeScript prop interfaces, accessibility requirements (WCAG AA), responsive breakpoints, and NativeWind mobile parity.

Where this document and [`../SCOPE.md`](../SCOPE.md) ever disagree, **`SCOPE.md` wins** (open a PR to fix the drift). All five tier names in this document (`unstable`, `developing`, `somewhat-stable`, `settled`, `stable`) are sourced from SCOPE §7 and the canonical-facts table in [`../README.md`](../README.md).

---

## 1. Design Tokens

Tokens are defined once and consumed by both platforms. On **web** they are CSS custom properties registered in `apps/web/src/app/globals.css` and mapped via `tailwind.config.ts`. On **mobile** they are re-exported as a plain TypeScript object from `packages/types/src/tokens.ts` and consumed by NativeWind's theme config (see §7).

### 1.1 Color Palette

All tokens use the `--stabil-` namespace for CSS custom properties. Hex values are the authoritative source; semantic names are aliases that reference hex values so that the tier scale and the semantic palette stay in sync.

#### Base palette — neutral (slate-based)

| Token name | CSS custom property | Hex (light) | Hex (dark) | Usage |
|---|---|---|---|---|
| `neutral-50` | `--stabil-neutral-50` | `#f8fafc` | `#0f172a` | Page background |
| `neutral-100` | `--stabil-neutral-100` | `#f1f5f9` | `#1e293b` | Surface / card |
| `neutral-200` | `--stabil-neutral-200` | `#e2e8f0` | `#334155` | Borders, dividers |
| `neutral-300` | `--stabil-neutral-300` | `#cbd5e1` | `#475569` | Disabled states |
| `neutral-500` | `--stabil-neutral-500` | `#64748b` | `#94a3b8` | Secondary text |
| `neutral-700` | `--stabil-neutral-700` | `#334155` | `#cbd5e1` | Primary body text |
| `neutral-900` | `--stabil-neutral-900` | `#0f172a` | `#f8fafc` | Headings / emphasis |

#### Brand palette — indigo-based

| Token name | CSS custom property | Hex | Usage |
|---|---|---|---|
| `brand-50` | `--stabil-brand-50` | `#eef2ff` | Interactive bg hover |
| `brand-100` | `--stabil-brand-100` | `#e0e7ff` | Chip / pill background |
| `brand-500` | `--stabil-brand-500` | `#6366f1` | Primary actions, links |
| `brand-600` | `--stabil-brand-600` | `#4f46e5` | Primary button fill |
| `brand-700` | `--stabil-brand-700` | `#4338ca` | Primary button hover |
| `brand-900` | `--stabil-brand-900` | `#312e81` | High-contrast brand text |

#### Feedback palette

| Token name | CSS custom property | Hex | Usage |
|---|---|---|---|
| `success-100` | `--stabil-success-100` | `#dcfce7` | Success background |
| `success-600` | `--stabil-success-600` | `#16a34a` | Success text/icon |
| `warning-100` | `--stabil-warning-100` | `#fef9c3` | Warning background |
| `warning-600` | `--stabil-warning-600` | `#ca8a04` | Warning text/icon |
| `error-100` | `--stabil-error-100` | `#fee2e2` | Error background |
| `error-600` | `--stabil-error-600` | `#dc2626` | Error text/icon |
| `info-100` | `--stabil-info-100` | `#dbeafe` | Info background |
| `info-600` | `--stabil-info-600` | `#2563eb` | Info text/icon |

#### TIER color scale

The tier color scale encodes stability level as color. Each tier has a **background**, a **foreground** (text/icon), and a **border** token. These colors have a minimum 4.5:1 contrast ratio between foreground and background (WCAG AA — see §5).

> **Critical accessibility rule:** tier color is a *supporting* cue only — it must **never** be the sole differentiator. Every tier display must also carry a text label and an icon. See §5.

| Tier | Slug | Score range | Background hex | Foreground hex | Border hex | Semantic name |
|---|---|---|---|---|---|---|
| Unstable | `unstable` | 0–499 | `#fee2e2` | `#991b1b` | `#fca5a5` | `--stabil-tier-unstable-bg / -fg / -border` |
| Developing | `developing` | 500–799 | `#fef3c7` | `#92400e` | `#fcd34d` | `--stabil-tier-developing-bg / -fg / -border` |
| Somewhat Stable | `somewhat-stable` | 800–1099 | `#dbeafe` | `#1e40af` | `#93c5fd` | `--stabil-tier-somewhat-stable-bg / -fg / -border` |
| Settled | `settled` | 1100–1349 | `#d1fae5` | `#065f46` | `#6ee7b7` | `--stabil-tier-settled-bg / -fg / -border` |
| Stable | `stable` | 1350–1500 | `#ede9fe` | `#3730a3` | `#c4b5fd` | `--stabil-tier-stable-bg / -fg / -border` |

> **Note:** score range bands are placeholders pending calibration (SCOPE §13). Update token documentation when bands are finalized — the token names must not change.

CSS custom property pattern (defined in `globals.css`):

```css
:root {
  --stabil-tier-unstable-bg:          #fee2e2;
  --stabil-tier-unstable-fg:          #991b1b;
  --stabil-tier-unstable-border:      #fca5a5;

  --stabil-tier-developing-bg:        #fef3c7;
  --stabil-tier-developing-fg:        #92400e;
  --stabil-tier-developing-border:    #fcd34d;

  --stabil-tier-somewhat-stable-bg:   #dbeafe;
  --stabil-tier-somewhat-stable-fg:   #1e40af;
  --stabil-tier-somewhat-stable-border: #93c5fd;

  --stabil-tier-settled-bg:           #d1fae5;
  --stabil-tier-settled-fg:           #065f46;
  --stabil-tier-settled-border:       #6ee7b7;

  --stabil-tier-stable-bg:            #ede9fe;
  --stabil-tier-stable-fg:            #3730a3;
  --stabil-tier-stable-border:        #c4b5fd;
}
```

TypeScript tier config object (re-exported from `packages/types/src/tokens.ts`):

```ts
import type { Tier } from "@stabil/scoring";

export const TIER_TOKENS = {
  unstable:        { bg: "#fee2e2", fg: "#991b1b", border: "#fca5a5", icon: "AlertTriangle", label: "Unstable" },
  developing:      { bg: "#fef3c7", fg: "#92400e", border: "#fcd34d", icon: "TrendingUp",   label: "Developing" },
  "somewhat-stable":{ bg: "#dbeafe", fg: "#1e40af", border: "#93c5fd", icon: "Activity",     label: "Somewhat Stable" },
  settled:         { bg: "#d1fae5", fg: "#065f46", border: "#6ee7b7", icon: "CheckCircle",   label: "Settled" },
  stable:          { bg: "#ede9fe", fg: "#3730a3", border: "#c4b5fd", icon: "Shield",        label: "Stable" },
} satisfies Record<Tier, { bg: string; fg: string; border: string; icon: string; label: string }>;
```

### 1.2 Spacing Scale

Based on a 4px base unit. All Tailwind spacing utilities map directly; the token names below are the underlying CSS custom property aliases for contexts that cannot use Tailwind (e.g. PDF renderer, NativeWind style objects).

| Token | px value | Tailwind class | Usage |
|---|---|---|---|
| `space-1` | 4px | `p-1` / `gap-1` | Tight internal padding (icon gap) |
| `space-2` | 8px | `p-2` / `gap-2` | Badge padding, small gaps |
| `space-3` | 12px | `p-3` / `gap-3` | Input padding, row spacing |
| `space-4` | 16px | `p-4` / `gap-4` | Card padding, section gap |
| `space-6` | 24px | `p-6` / `gap-6` | Page section padding |
| `space-8` | 32px | `p-8` / `gap-8` | Section between major blocks |
| `space-12` | 48px | `p-12` / `gap-12` | Top-of-page hero spacing |
| `space-16` | 64px | `p-16` / `gap-16` | Page-level vertical rhythm |

### 1.3 Typography Scale

Font family: `Inter` (variable font, self-hosted via `next/font/google`). Monospace: `JetBrains Mono` for numeric scores and code snippets.

| Token | CSS class | Size / Line-height / Weight | Usage |
|---|---|---|---|
| `text-display` | `text-4xl font-bold` | 36px / 1.1 / 700 | Score number in report hero |
| `text-h1` | `text-3xl font-bold` | 30px / 1.2 / 700 | Page titles |
| `text-h2` | `text-2xl font-semibold` | 24px / 1.3 / 600 | Section headings |
| `text-h3` | `text-xl font-semibold` | 20px / 1.4 / 600 | Card / sub-section headings |
| `text-h4` | `text-base font-semibold` | 16px / 1.5 / 600 | Parameter group labels |
| `text-body` | `text-sm` | 14px / 1.6 / 400 | Body, descriptions |
| `text-body-lg` | `text-base` | 16px / 1.6 / 400 | Report body text |
| `text-caption` | `text-xs` | 12px / 1.5 / 400 | Helper text, footnotes |
| `text-label` | `text-xs font-medium` | 12px / 1.0 / 500 | Form labels, badge text |
| `text-mono` | `font-mono text-2xl font-bold` | 24px / 1.0 / 700 | Score display (JetBrains Mono) |

Minimum rendered body text size is 14px (`text-sm`) to ensure readability and WCAG SC 1.4.4 compliance.

### 1.4 Border Radius Scale

| Token | CSS custom property | Value | Tailwind | Usage |
|---|---|---|---|---|
| `radius-sm` | `--radius-sm` | 4px | `rounded` | Input, small chip |
| `radius-md` | `--radius-md` | 8px | `rounded-lg` | Card, dialog |
| `radius-lg` | `--radius-lg` | 12px | `rounded-xl` | Panel, score gauge container |
| `radius-full` | `--radius-full` | 9999px | `rounded-full` | Badge, avatar |

shadcn/ui's `--radius` variable is set to `0.5rem` (8px) to match `radius-md`, ensuring all shadcn components use the Stabil radius base.

### 1.5 Shadow Scale

| Token | CSS custom property | Value | Tailwind | Usage |
|---|---|---|---|---|
| `shadow-sm` | `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)` | `shadow-sm` | Subtle card lift |
| `shadow-md` | `--shadow-md` | `0 4px 6px rgba(0,0,0,0.07)` | `shadow-md` | Card, input focus ring container |
| `shadow-lg` | `--shadow-lg` | `0 10px 15px rgba(0,0,0,0.10)` | `shadow-lg` | Dialog, popover, dropdown |
| `shadow-focus` | `--shadow-focus` | `0 0 0 3px rgba(99,102,241,0.45)` | custom | Keyboard focus ring (brand-500 at 45% opacity) |

### 1.6 Z-Index Scale

| Token | Value | Usage |
|---|---|---|
| `z-base` | 0 | Normal document flow |
| `z-raised` | 10 | Sticky table headers, sticky nav |
| `z-dropdown` | 20 | Select dropdowns, autocomplete |
| `z-sticky` | 30 | Sticky sidebars, parameter rows |
| `z-overlay` | 40 | Dialog backdrop |
| `z-dialog` | 50 | Dialog panel |
| `z-toast` | 60 | Toast notifications (always on top) |

---

## 2. Theming — Light / Dark Mode

### 2.1 CSS variables + Tailwind config

Stabil uses **class-based dark mode** (`darkMode: "class"` in `tailwind.config.ts`). The `<html>` element receives the `dark` class when the user's preference or explicit toggle is active.

All semantic tokens are defined as CSS custom properties with two values: one in `:root` (light) and one in `.dark` (dark). Example from `apps/web/src/app/globals.css`:

```css
/* ---- light theme (default) ---- */
:root {
  --background:          var(--stabil-neutral-50);   /* #f8fafc */
  --foreground:          var(--stabil-neutral-900);  /* #0f172a */
  --surface:             var(--stabil-neutral-100);  /* #f1f5f9 */
  --border:              var(--stabil-neutral-200);  /* #e2e8f0 */
  --muted:               var(--stabil-neutral-500);  /* #64748b */
  --primary:             var(--stabil-brand-600);    /* #4f46e5 */
  --primary-foreground:  #ffffff;
  --ring:                var(--stabil-brand-500);    /* #6366f1 */
}

/* ---- dark theme ---- */
.dark {
  --background:          var(--stabil-neutral-50);   /* remapped → #0f172a */
  --foreground:          var(--stabil-neutral-900);  /* remapped → #f8fafc */
  --surface:             var(--stabil-neutral-100);  /* remapped → #1e293b */
  --border:              var(--stabil-neutral-200);  /* remapped → #334155 */
  --muted:               var(--stabil-neutral-500);  /* remapped → #94a3b8 */
  --primary:             var(--stabil-brand-500);    /* #6366f1 — slightly lighter */
  --primary-foreground:  #ffffff;
  --ring:                var(--stabil-brand-500);
}
```

Tier tokens do **not** change between light and dark because their background/foreground pairs are already independently tested for contrast in both modes. If the hosting dark background (`#0f172a`) causes any tier badge background to fail the 3:1 non-text contrast threshold, add a 1px border using the tier's `-border` token.

### 2.2 Tailwind config excerpt

```ts
// apps/web/tailwind.config.ts
import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        surface:    "hsl(var(--surface))",
        border:     "hsl(var(--border))",
        muted:      "hsl(var(--muted))",
        primary: {
          DEFAULT:    "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        ring: "hsl(var(--ring))",
        // Tier colors (static — not remapped in dark)
        tier: {
          "unstable-bg":           "#fee2e2",
          "unstable-fg":           "#991b1b",
          "developing-bg":         "#fef3c7",
          "developing-fg":         "#92400e",
          "somewhat-stable-bg":    "#dbeafe",
          "somewhat-stable-fg":    "#1e40af",
          "settled-bg":            "#d1fae5",
          "settled-fg":            "#065f46",
          "stable-bg":             "#ede9fe",
          "stable-fg":             "#3730a3",
        },
      },
      borderRadius: {
        sm:   "0.25rem",
        md:   "0.5rem",
        lg:   "0.75rem",
        full: "9999px",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-jetbrains)", "monospace"],
      },
      boxShadow: {
        focus: "0 0 0 3px rgba(99,102,241,0.45)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
```

### 2.3 Theme toggle component

The `<ThemeToggle>` component (in `apps/web/src/components/ui/theme-toggle.tsx`) reads from `next-themes` and toggles the `dark` class on `<html>`. It stores the preference in `localStorage`. The system preference is the default (`defaultTheme="system"`).

```tsx
// Usage in layout
import { ThemeProvider } from "next-themes";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
```

---

## 3. shadcn/ui Component Inventory

All shadcn/ui components are installed into `apps/web/src/components/ui/` via the shadcn CLI (`pnpm dlx shadcn@latest add <component>`). They consume the CSS custom properties defined in §2 automatically.

Each component below lists its installation status, any Stabil-specific customization, and usage notes.

### 3.1 Button

**Import:** `@/components/ui/button`
**Customization:** no structural change. The `variant="default"` uses `--primary` / `--primary-foreground`. An additional `variant="tier"` is added for tier-related CTAs (see §4.1).

```tsx
import { Button } from "@/components/ui/button";

// Standard variants (shadcn)
<Button variant="default">Score my profile</Button>
<Button variant="outline">View details</Button>
<Button variant="ghost">Cancel</Button>
<Button variant="destructive">Delete account</Button>

// Stabil loading state wrapper (thin extension, not a full override)
<Button disabled aria-busy="true">
  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
  Calculating score…
</Button>
```

All `Button` instances receive an explicit `aria-label` when the visible text is an icon only.

### 3.2 Card

**Import:** `@/components/ui/card`
**Customization:** `Card` uses `--surface` background and `--border` border. `CardHeader`, `CardContent`, `CardFooter` are used as-is. A Stabil-specific `ScoreCard` layout wrapper (not a new shadcn component) composes `Card` with a fixed header height and a `data-tier` attribute for CSS targeting.

```tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

<Card className="shadow-md">
  <CardHeader>
    <CardTitle>Stability Overview</CardTitle>
  </CardHeader>
  <CardContent>…</CardContent>
</Card>
```

### 3.3 Form

**Import:** `@/components/ui/form`
**Integration:** always used with `react-hook-form` + Zod resolver (see [state-and-forms.md](state-and-forms.md)). `FormField`, `FormItem`, `FormLabel`, `FormControl`, `FormDescription`, and `FormMessage` are used in every multi-step form. `FormMessage` surfaces Zod validation errors automatically.

```tsx
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";

<Form {...form}>
  <form onSubmit={form.handleSubmit(onSubmit)}>
    <FormField
      control={form.control}
      name="workMode"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Work mode preference</FormLabel>
          <FormControl>
            <Select onValueChange={field.onChange} defaultValue={field.value}>
              {/* … */}
            </Select>
          </FormControl>
          <FormMessage /> {/* auto-renders Zod error */}
        </FormItem>
      )}
    />
  </form>
</Form>
```

### 3.4 Input

**Import:** `@/components/ui/input`
**Customization:** focus ring uses `--ring` (brand-500 at 45% opacity, `shadow-focus`). Disabled state uses `--neutral-300` background. No structural override.

```tsx
import { Input } from "@/components/ui/input";

<Input
  type="text"
  placeholder="Full name"
  aria-describedby="name-hint"
/>
<p id="name-hint" className="text-xs text-muted">As it appears on your ID</p>
```

### 3.5 Select

**Import:** `@/components/ui/select`
**Usage:** `Select`, `SelectTrigger`, `SelectContent`, `SelectItem`, `SelectValue`. All enum-backed form fields (mode, work preference, relocation, etc.) use `Select`. Never use a raw `<select>` element — shadcn's `Select` is accessible (keyboard, ARIA) out of the box.

```tsx
import {
  Select, SelectTrigger, SelectContent, SelectItem, SelectValue,
} from "@/components/ui/select";

<Select onValueChange={field.onChange} defaultValue={field.value}>
  <SelectTrigger aria-label="Work mode preference">
    <SelectValue placeholder="Select work mode…" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="hybrid">Hybrid</SelectItem>
    <SelectItem value="onsite">On-site</SelectItem>
    <SelectItem value="remote">Remote</SelectItem>
  </SelectContent>
</Select>
```

### 3.6 Stepper / Tabs (multi-step forms)

Stabil does not use a separate shadcn `Stepper` component (none exists in shadcn/ui core). Multi-step forms use shadcn's **`Tabs`** component re-skinned as a horizontal step indicator. The step state is managed by `react-hook-form` with per-step Zod sub-schemas (see [state-and-forms.md](state-and-forms.md)).

**Import:** `@/components/ui/tabs`

```tsx
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Tabs used as step indicator only (content is rendered separately, not via TabsContent)
<Tabs value={String(currentStep)}>
  <TabsList role="tablist" aria-label="Form steps">
    {steps.map((step, i) => (
      <TabsTrigger
        key={step.id}
        value={String(i)}
        disabled={i > maxVisitedStep}
        aria-current={currentStep === i ? "step" : undefined}
      >
        {step.label}
      </TabsTrigger>
    ))}
  </TabsList>
</Tabs>
```

The `Tabs` component is also used as-intended (with `TabsContent`) on the report dashboard to switch between Candidate and Employer views (admin/employer accounts only).

### 3.7 Dialog

**Import:** `@/components/ui/dialog`
**Usage:** consent confirmation modal (SCOPE §6.2), document upload preview, delete-account confirmation, PDF export progress. Every `Dialog` must have a `DialogTitle` (for screen readers; may be visually hidden via `sr-only` if design requires).

```tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

<Dialog open={isConsentOpen} onOpenChange={setConsentOpen}>
  <DialogContent aria-describedby="consent-desc">
    <DialogHeader>
      <DialogTitle>Share your report with {requester.name}?</DialogTitle>
      <DialogDescription id="consent-desc">
        They will see your full score breakdown…
      </DialogDescription>
    </DialogHeader>
    <DialogFooter>
      <Button variant="outline" onClick={() => setConsentOpen(false)}>Decline</Button>
      <Button onClick={grantConsent}>Grant access</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

Focus is trapped inside `Dialog` automatically (Radix UI / shadcn). `Escape` always closes.

### 3.8 Badge

**Import:** `@/components/ui/badge`
**Extension:** `Badge` is extended with a `tier` variant via `cva`. The Stabil-specific `TierBadge` component (§4.1) wraps `Badge` — do not use raw `Badge` with tier colors directly; use `TierBadge` instead.

Standard badge variants:

```tsx
import { Badge } from "@/components/ui/badge";

<Badge variant="default">Verified</Badge>      {/* brand-600 fill */}
<Badge variant="outline">Pending review</Badge>
<Badge variant="secondary">Optional</Badge>
```

### 3.9 Toast

**Import:** `@/components/ui/toast` + `@/components/ui/toaster` + `@/hooks/use-toast`
**Usage:** score-run success, consent grant/revoke confirmation, document upload status, errors from API. The `Toaster` is mounted once in the root layout. Use `useToast()` at the call site.

```tsx
const { toast } = useToast();

// Success
toast({
  title: "Score updated",
  description: "Your new Stabil score is 1 180 (Settled).",
});

// Error
toast({
  variant: "destructive",
  title: "Upload failed",
  description: "Only PDF, PNG, and JPEG are accepted.",
});
```

Toasts are auto-dismissed after 5 seconds (`duration: 5000`). They are positioned `bottom-right` and respect the z-index `z-toast` (60).

### 3.10 Table

**Import:** `@/components/ui/table`
**Usage:** parameter breakdown in the report (candidate and employer views), employer multi-candidate comparison table (Phase 4). `Table` + `TableHeader` + `TableRow` + `TableHead` + `TableBody` + `TableCell` are used. All data tables must have a `<caption>` (visually hidden if needed) for screen readers.

```tsx
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

<Table>
  <TableCaption className="sr-only">Parameter-by-parameter score breakdown</TableCaption>
  <TableHeader>
    <TableRow>
      <TableHead scope="col">Parameter</TableHead>
      <TableHead scope="col" className="text-right">Points earned</TableHead>
      <TableHead scope="col" className="text-right">Max points</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    {breakdown.map((row) => (
      <TableRow key={row.key}>
        <TableCell>{row.label}</TableCell>
        <TableCell className="text-right font-mono">{row.awarded}</TableCell>
        <TableCell className="text-right text-muted font-mono">{row.max}</TableCell>
      </TableRow>
    ))}
  </TableBody>
</Table>
```

### 3.11 Skeleton

**Import:** `@/components/ui/skeleton`
**Usage:** loading states for the report dashboard, score gauge, parameter rows. Every data-bound surface must show a `Skeleton` while TanStack Query is in `isLoading` state. Skeleton shapes must closely mirror the actual content dimensions to prevent layout shift.

```tsx
import { Skeleton } from "@/components/ui/skeleton";

// Score gauge placeholder
<div className="flex flex-col items-center gap-4">
  <Skeleton className="h-48 w-48 rounded-full" />
  <Skeleton className="h-6 w-32" />
  <Skeleton className="h-4 w-24" />
</div>
```

### 3.12 Tooltip

**Import:** `@/components/ui/tooltip` — must be wrapped in `<TooltipProvider>` at the root.
**Usage:** parameter explanations (what does "tenure" measure?), score breakdown row hints, improvement tip icons. All tooltip triggers must be keyboard-focusable and use `aria-describedby` or `aria-label` pointing to the tooltip content.

```tsx
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

<Tooltip>
  <TooltipTrigger asChild>
    <button aria-label="What is tenure?" className="text-muted hover:text-foreground">
      <HelpCircle className="h-4 w-4" aria-hidden />
    </button>
  </TooltipTrigger>
  <TooltipContent>
    <p>Average time spent per job role. Longer tenure indicates higher stability.</p>
  </TooltipContent>
</Tooltip>
```

---

## 4. Stabil-Specific Components

These five components are not in shadcn/ui; they are domain-specific to Stabil and live in `apps/web/src/components/stabil/`. All have NativeWind equivalents in `apps/mobile/src/components/stabil/` (see §7).

### 4.1 TierBadge

Renders a tier name with its associated color, an icon, and optionally the score range. Used everywhere a tier is displayed: report header, parameter table, candidate list.

**File:** `apps/web/src/components/stabil/tier-badge.tsx`

```ts
import type { Tier } from "@stabil/scoring";

interface TierBadgeProps {
  /** The stability tier slug from @stabil/scoring */
  tier: Tier;
  /**
   * Controls how much information is shown.
   * - "compact": icon + label only (used inline in tables, lists)
   * - "full": icon + label + score range (used in report hero, cards)
   */
  size?: "compact" | "full";
  /** Override the score range text (use when calibrated bands differ from token defaults) */
  scoreRange?: string;
  /** Additional CSS classes (web only) */
  className?: string;
}
```

Implementation notes:
- Background, foreground, and border are taken from `TIER_TOKENS[tier]` (see §1.1).
- Icon is always rendered (`aria-hidden="true"`), label is always rendered as visible text — color is never the sole signal (WCAG SC 1.4.1).
- In `"full"` mode, the score range text is rendered as a `<span>` with `aria-label` that includes the range: `aria-label="Tier: Settled, score range 1 100–1 349"`.

```tsx
// Usage examples
<TierBadge tier="settled" size="compact" />
<TierBadge tier="stable" size="full" scoreRange="1 350–1 500" />
```

### 4.2 ScoreGauge (container)

The `ScoreGauge` is a **container component** — it does not render the chart itself. It provides the outer `<section>` wrapper, the score number (formatted with `Intl.NumberFormat`), the tier badge, and the `<div>` mount point that `charts.md` [→ see charts.md](charts.md) uses to render the Chart.js doughnut/arc chart inside. This separation keeps chart implementation details out of the design system.

**File:** `apps/web/src/components/stabil/score-gauge.tsx`

```ts
interface ScoreGaugeProps {
  /** Numeric total score (0–1500) */
  total: number;
  /** Maximum possible score (always 1500 in the current model) */
  maxTotal: number;
  /** Resolved tier for this score run */
  tier: Tier;
  /**
   * Render prop that receives a stable ref for the chart canvas mount point.
   * The actual Chart.js chart is rendered by the caller; this component only provides the container.
   */
  chartSlot: React.ReactNode;
  /** Loading state — renders Skeleton instead of score content */
  isLoading?: boolean;
  /** Additional CSS classes */
  className?: string;
}
```

Layout structure (ASCII wireframe):

```
┌──────────────────────────────────────┐
│  [chartSlot — doughnut arc goes here]│  ← 192×192px canvas, centered
│                                       │
│         1 180 / 1 500                 │  ← font-mono text-2xl (score)
│         [TierBadge tier="settled"]    │  ← TierBadge compact
│                                       │
│  "Settled · 1 100–1 349 points"      │  ← text-caption text-muted
└──────────────────────────────────────┘
```

The `<section>` carries `aria-label="Stability score: 1180 out of 1500 — Settled"` so screen readers get the complete picture without needing to parse the chart.

### 4.3 ParameterRow

Renders one row in the per-parameter breakdown table (or a stacked card on mobile). Used inside the report dashboard for both candidate and employer views.

**File:** `apps/web/src/components/stabil/parameter-row.tsx`

```ts
interface ParameterRowProps {
  /** Human-readable parameter label (e.g. "Tenure", "Academics") */
  label: string;
  /** Points awarded for this parameter (integer) */
  awarded: number;
  /** Maximum possible points for this parameter (integer) */
  max: number;
  /**
   * Block this parameter belongs to.
   * "mode" | "common" | "verification"
   * Used to group rows visually (e.g. collapsible section per block).
   */
  block: "mode" | "common" | "verification";
  /**
   * Whether this row is visible to the current audience.
   * Rows with visibility="employer-only" must never render in candidate view.
   * This prop exists so the parent can pass filtered data safely;
   * ParameterRow does NOT perform audience filtering itself.
   */
  visible: boolean;
  /** Optional improvement hint shown as a collapsible below the row */
  improvementHint?: string;
  /** Tooltip/help text explaining what the parameter measures */
  helpText?: string;
  /** Whether the row is in a loading state */
  isLoading?: boolean;
}
```

Rendering rules:
- `visible === false` → render nothing (`null`). The parent passes only visible rows (filtered by `filterForAudience` from `@stabil/scoring`).
- The progress proportion (`awarded / max`) is rendered as both a visual progress bar **and** as text (`awarded / max`) — the bar is never the only encoding (WCAG SC 1.4.1).
- If `improvementHint` is provided, a `ChevronDown` expand toggle is rendered after the row — keyboard accessible (`button` element, `aria-expanded`).

```tsx
// Usage (inside the report parameter table)
{breakdown.map((row) => (
  <ParameterRow
    key={row.key}
    label={row.label}
    awarded={row.awarded}
    max={row.max}
    block={row.block}
    visible={row.visible}
    helpText={row.helpText}
    improvementHint={audience === "candidate" ? row.improvementHint : undefined}
  />
))}
```

### 4.4 ConsentBanner

Renders the full-page or modal consent request shown to a candidate when an employer or recruiter has requested access to their report (SCOPE §6.2). This is NOT an optional notice — it is a hard gate.

**File:** `apps/web/src/components/stabil/consent-banner.tsx`

```ts
interface ShareRequester {
  name: string;
  /** "employer" | "recruiter" */
  role: "employer" | "recruiter";
  /** Company or agency name, if available */
  organization?: string;
}

interface ConsentBannerProps {
  /** The entity requesting access to the candidate's report */
  requester: ShareRequester;
  /** ISO 8601 datetime string when the request was made */
  requestedAt: string;
  /**
   * List of data categories that will be shared.
   * Rendered as a bulleted list inside the banner.
   * Sensitive attrs (age, marital status) must be listed explicitly if included.
   */
  dataCategories: string[];
  /** Called when the candidate grants consent */
  onGrant: () => void | Promise<void>;
  /** Called when the candidate declines */
  onDecline: () => void | Promise<void>;
  /** Async loading state for the grant/decline action */
  isSubmitting?: boolean;
}
```

Accessibility requirements:
- Rendered inside a `Dialog` (§3.7) with `role="alertdialog"` and `aria-modal="true"`.
- Focus is trapped. The **Decline** button receives initial focus (safer default).
- Both buttons carry `aria-busy` when `isSubmitting` is true.
- The list of `dataCategories` is a `<ul>` with `aria-label="Data that will be shared"`.

```tsx
// Usage
<ConsentBanner
  requester={{ name: "Acme Corp", role: "employer" }}
  requestedAt="2026-06-06T10:00:00Z"
  dataCategories={[
    "Overall stability score (1 180 / 1 500)",
    "Tier: Settled",
    "Parameter breakdown (including age and marital status)",
    "Verification status",
  ]}
  onGrant={handleGrant}
  onDecline={handleDecline}
  isSubmitting={isPending}
/>
```

### 4.5 VerifiedUserBadge

Renders a trust indicator that a candidate's key claims have been document-verified (SCOPE §5, Phase 3). Displayed in the report header and the candidate's profile page.

**File:** `apps/web/src/components/stabil/verified-user-badge.tsx`

```ts
interface VerifiedUserBadgeProps {
  /**
   * Whether the candidate holds Verified User status.
   * When false, renders an "Unverified" / "Get verified" nudge instead.
   */
  isVerified: boolean;
  /**
   * Documents that contributed to verification.
   * Shown as a tooltip list. Each entry is a document type label.
   * Example: ["Aadhaar card", "PAN card"]
   */
  verifiedDocuments?: string[];
  /**
   * Controls display mode.
   * "badge": small inline badge (for tables, lists)
   * "card": larger card with CTA to upload documents (for candidate profile)
   */
  variant?: "badge" | "card";
  /**
   * Called when the user clicks the "Get verified" CTA (card variant, unverified only).
   * Navigation to the documents upload page is the caller's responsibility.
   */
  onVerifyCta?: () => void;
  className?: string;
}
```

Rendering rules:
- When `isVerified` is true: renders a `ShieldCheck` icon + "Verified" label in `success-600` color with `success-100` background.
- When `isVerified` is false and `variant === "badge"`: renders a neutral "Not verified" state without icon color (no alarming red — this is informational, not an error).
- When `isVerified` is false and `variant === "card"`: renders an expanded card explaining verification benefits and a "Verify your identity" CTA button.
- The `ShieldCheck` icon is always `aria-hidden` — the visible label carries the meaning.
- `verifiedDocuments` list is exposed via a `Tooltip` (§3.12) on the badge, with `aria-label="Verified documents: Aadhaar card, PAN card"` on the trigger.

```tsx
// Usage — report header
<VerifiedUserBadge
  isVerified={profile.isVerified}
  verifiedDocuments={["Aadhaar card"]}
  variant="badge"
/>

// Usage — candidate profile page
<VerifiedUserBadge
  isVerified={false}
  variant="card"
  onVerifyCta={() => router.push("/documents")}
/>
```

---

## 5. Accessibility (WCAG AA)

All web surfaces target **WCAG 2.1 Level AA**. Mobile surfaces target equivalent APCA/WCAG guidance applicable to iOS and Android.

### 5.1 Color contrast

| Context | Minimum ratio | Verification method |
|---|---|---|
| Normal text (< 18px / < 14px bold) | 4.5 : 1 | Check every token pair against `--background` and `--surface` |
| Large text (≥ 18px / ≥ 14px bold) | 3 : 1 | Applies to `text-display`, `text-h1`, `text-h2` |
| Non-text UI elements (icons, borders, focus rings) | 3 : 1 | Applies to tier badge borders in dark mode |
| Disabled UI elements | No requirement | Still use `opacity-50` to communicate state |

All tier foreground/background pairs above exceed 4.5:1 in the light theme. In dark mode, the tier background is placed on a `#1e293b` (`--surface`) base — verify with a contrast checker at implementation time.

### 5.2 Tiers and charts must not rely on color alone

This is a hard rule. WCAG SC 1.4.1 prohibits using color as the only visual means of conveying information.

**Tier displays must always include:**
1. A text label (e.g. "Settled") — never just a colored dot.
2. An icon (see `TIER_TOKENS[tier].icon` in §1.1) that is unique per tier.

**Charts must always include** (see [charts.md](charts.md) for chart-specific requirements):
- Labels on data points or in a legend.
- Patterns or texture on filled areas (doughnut, radar) when multiple tiers are compared.
- `aria-label` on the `<canvas>` element with a full text summary.
- A companion data table (`<details>/<summary>` or hidden `<table>`) for screen readers.

Example compliant tier display vs. non-compliant:

```tsx
// COMPLIANT — color + icon + label
<TierBadge tier="settled" size="compact" />
// Renders: <CheckCircle aria-hidden /> + "Settled" text + green background

// NON-COMPLIANT — color alone (never do this)
<span className="h-3 w-3 rounded-full bg-tier-settled-bg" />
```

### 5.3 Focus management

- All interactive elements receive a visible focus ring using `shadow-focus` (`0 0 0 3px rgba(99,102,241,0.45)`), overriding the browser default.
- In Tailwind: `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`.
- Focus is never removed (`outline: none`) without an equivalent replacement.
- **Dialogs** (shadcn `Dialog`) trap focus automatically via Radix UI.
- **Multi-step forms:** when advancing a step, focus moves to the first input of the new step (managed in the form controller).
- **Toasts:** are announced via `aria-live="polite"` by the `Toaster` component.
- **Route changes** (Next.js App Router): a visually hidden `<h1>` with `aria-live="polite"` announces the new page title on navigation.

### 5.4 ARIA patterns

| Pattern | Implementation |
|---|---|
| Multi-step form progress | `role="progressbar"` with `aria-valuenow`, `aria-valuemin=1`, `aria-valuemax={totalSteps}` |
| Parameter rows (collapsible) | `aria-expanded` on trigger, `aria-controls` pointing to content `id` |
| Consent dialog | `role="alertdialog"`, `aria-modal="true"`, `aria-labelledby`, `aria-describedby` |
| Score number | `aria-label="Stability score: 1180 out of 1500"` on the container |
| Tier badge | Icon is `aria-hidden`; label text is visible; container has `aria-label="Tier: Settled"` |
| Verified badge | `aria-label="Verified User — Aadhaar card verified"` |
| Chart canvas | `role="img"` + `aria-label="[full text description]"` + companion `<table>` |
| Table | Explicit `<caption>` (may be `sr-only`) and `scope="col"` / `scope="row"` on all headers |

### 5.5 Keyboard navigation

- All form controls reachable in logical DOM order via `Tab`.
- Select dropdowns operable with arrow keys, `Enter`, `Escape` (Radix UI).
- Modals closed with `Escape`.
- Stepper / tabs operable with arrow keys when the focus is on `TabsList`.
- No keyboard traps outside of `Dialog` (which is intentional and WCAG-compliant).

---

## 6. Responsive Breakpoints

Stabil uses Tailwind's breakpoint system with no custom breakpoints added. The default scale is:

| Breakpoint | Min-width | CSS media query | Primary usage |
|---|---|---|---|
| `(default)` | 0px | — | Mobile-first base styles |
| `sm` | 640px | `@media (min-width: 640px)` | Larger phones, small tablets |
| `md` | 768px | `@media (min-width: 768px)` | Tablets, landscape phones |
| `lg` | 1024px | `@media (min-width: 1024px)` | Laptops (primary desktop breakpoint) |
| `xl` | 1280px | `@media (min-width: 1280px)` | Wide desktops, sidebars expand |
| `2xl` | 1536px | `@media (min-width: 1536px)` | Ultra-wide, max content width capped at 1280px |

### 6.1 Layout grid

The main content area uses a 12-column grid at `lg` and above, a 4-column grid at `sm`–`md`, and a single-column stack at the default (mobile) breakpoint.

| Breakpoint | Columns | Max content width | Side padding |
|---|---|---|---|
| Default (mobile) | 1 | 100% | `px-4` (16px each side) |
| `sm` | 4 | 100% | `px-6` (24px each side) |
| `md` | 4 | 100% | `px-8` (32px each side) |
| `lg` | 12 | 1024px | `px-8` |
| `xl` | 12 | 1280px | `px-8` |

### 6.2 Component behavior at breakpoints

| Component | Mobile (default) | Desktop (lg+) |
|---|---|---|
| Navigation | Bottom tab bar (mobile app) / hamburger drawer (web) | Side navigation (`w-64` fixed sidebar) |
| Report dashboard | Stacked cards, single column | Two-column: score gauge left, parameter breakdown right |
| ParameterRow | Card layout (label above, points below) | Table row layout |
| Multi-step form | Full-width, one question visible | Centered panel (`max-w-lg`) |
| ScoreGauge | 160px canvas, full-width container | 192px canvas, 50% width column |
| ConsentBanner | Full-screen dialog | Centered modal, `max-w-md` |
| Employer comparison table | Horizontal scroll (`overflow-x-auto`) | Full-width table, fixed first column |

---

## 7. Mobile Parity via NativeWind

`apps/mobile` shares all design tokens with `apps/web` through `packages/types/src/tokens.ts`. NativeWind (v4) maps Tailwind class names to React Native `StyleSheet` rules, so most utility classes used on web work verbatim on mobile.

### 7.1 Shared token import

```ts
// packages/types/src/tokens.ts (consumed by both platforms)
export { TIER_TOKENS } from "./tier-tokens";
export * from "./spacing";
export * from "./typography";
export * from "./radius";
```

```ts
// apps/mobile/tailwind.config.ts — points to the shared token exports
import { TIER_TOKENS } from "@stabil/types";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Re-declare tier colors from shared tokens (NativeWind resolves these at build time)
        "tier-unstable-bg":        TIER_TOKENS.unstable.bg,
        "tier-unstable-fg":        TIER_TOKENS.unstable.fg,
        // …repeat for all 5 tiers…
        "tier-stable-bg":          TIER_TOKENS.stable.bg,
        "tier-stable-fg":          TIER_TOKENS.stable.fg,
        primary: "#4f46e5",
        background: "#f8fafc",
        surface: "#f1f5f9",
        border: "#e2e8f0",
        muted: "#64748b",
      },
      borderRadius: {
        sm: 4, md: 8, lg: 12, full: 9999,
      },
    },
  },
  plugins: [],
};
```

### 7.2 Component parity

| Web component | Mobile equivalent | Notes |
|---|---|---|
| `TierBadge` | `apps/mobile/src/components/stabil/TierBadge.tsx` | Identical props; uses `View` + `Text` + Lucide RN icon |
| `ScoreGauge` (container) | `apps/mobile/src/components/stabil/ScoreGauge.tsx` | Chart slot accepts a `react-native-svg` arc or `victory-native` chart |
| `ParameterRow` | `apps/mobile/src/components/stabil/ParameterRow.tsx` | Card layout only (no table on mobile) |
| `ConsentBanner` | `apps/mobile/src/components/stabil/ConsentBanner.tsx` | Uses RN `Modal` with full-screen overlay |
| `VerifiedUserBadge` | `apps/mobile/src/components/stabil/VerifiedUserBadge.tsx` | Identical props; `Pressable` for CTA variant |

### 7.3 NativeWind dark mode

Dark mode on mobile follows the device system preference via `useColorScheme()` from `react-native`. NativeWind's `dark:` variant is applied automatically. The same semantic class names used on web (`bg-surface`, `text-foreground`, etc.) resolve correctly in NativeWind when the shared tailwind config declares them.

```tsx
// Mobile component — same class names as web
<View className="bg-surface rounded-lg p-4 shadow-md dark:bg-neutral-800">
  <Text className="text-foreground text-base font-semibold">Stability score</Text>
</View>
```

### 7.4 Platform-specific overrides

Some tokens behave differently on native:

| Token | Web behavior | Mobile override |
|---|---|---|
| `shadow-focus` | CSS `box-shadow` with 3px ring | Not applicable — use `borderWidth: 2, borderColor: "#6366f1"` on focused state |
| `shadow-md` | CSS `box-shadow` | `elevation: 4` (Android) + `shadowOpacity: 0.1` (iOS) via NativeWind shadow utilities |
| `font-mono` | CSS `font-family: JetBrains Mono` | Loaded via `expo-font` in `apps/mobile/src/app/_layout.tsx` |
| `z-dialog` / `z-toast` | CSS z-index 50/60 | React Native `Modal` with `transparent` and RN z-ordering (no z-index needed) |

Charts on mobile use `react-native-svg` as the rendering backend. See [charts.md](charts.md) for chart-per-metric specifications and the mobile chart implementation.

---

## Cross-references

- **Charts:** data visualization components (doughnut/arc gauge, radar, bar) and their accessibility implementation → [charts.md](charts.md)
- **Best practices:** performance (font loading, image optimization, skeleton strategy), error UX, testing conventions → [best-practices.md](best-practices.md)
- **State and forms:** TanStack Query integration, react-hook-form + Zod multi-step form controller → [state-and-forms.md](state-and-forms.md)
- **Mobile specifics:** Expo navigation, NativeWind layout, mobile-only patterns → [mobile.md](mobile.md)
- **Scoring tiers (authoritative):** tier names, score ranges (pending calibration), visibility rules → [../SCOPE.md](../SCOPE.md) §7, [../architecture/03-scoring-engine.md](../architecture/03-scoring-engine.md)
- **Audience filtering (sensitive attr suppression):** how `age`/`maritalStatus` are hidden from candidate view in the report → [../architecture/05-security-privacy.md](../architecture/05-security-privacy.md), SCOPE §6.3
