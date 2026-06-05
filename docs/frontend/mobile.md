# Mobile — Expo / React Native Specifics

> **Status:** Draft v0.1 · **Phase:** cross-cutting (Phase 1 parity → Phase 2/3 capture) · **Owner area:** frontend
> **Related:** [frontend/README.md](README.md) · [frontend/charts.md](charts.md) · [frontend/design-system.md](design-system.md) · [frontend/state-and-forms.md](state-and-forms.md) · [frontend/pages/onboarding-auth.md](pages/onboarding-auth.md) · [frontend/pages/mode-selection-and-forms.md](pages/mode-selection-and-forms.md) · [frontend/pages/documents-and-verification.md](pages/documents-and-verification.md) · [frontend/pages/candidate-report.md](pages/candidate-report.md) · [frontend/pages/account-consent-settings.md](pages/account-consent-settings.md) · [architecture/01-overview.md](../architecture/01-overview.md) · [architecture/05-security-privacy.md](../architecture/05-security-privacy.md) · [SCOPE.md](../SCOPE.md)

The mobile app (`apps/mobile`) is the **Expo / React Native** client for Stabil. It is a first-class surface alongside the Next.js web app (SCOPE §2 decision 21): candidates onboard, score themselves, view their report, manage consent, and upload documents entirely on-device. The app targets **iOS and Android** via a single TypeScript codebase, sharing all business logic, type definitions, Zod schemas, and the API client with the web app. Only the UI layer and navigation are platform-specific.

This document covers everything that differs from or extends the web frontend: navigation conventions, styling parity, secure storage, document/ID capture, charting, push notifications, offline drafts, the web↔mobile feature parity matrix, the shared-vs-platform-specific boundary, and EAS build basics.

---

## 1. Navigation — Expo Router (file-based, route groups, auth gating)

### 1.1 Why Expo Router

Expo Router brings **file-system routing** (the same mental model as Next.js App Router) to React Native. Route groups, dynamic segments, and shared layouts are expressed identically to the web app wherever possible, which lowers the cognitive cost of owning both clients. It uses React Navigation under the hood so all native stack/tab primitives are available.

### 1.2 File tree — `apps/mobile/app/`

```
apps/mobile/
├── app/
│   ├── _layout.tsx                   # root layout — providers, auth gate, push-notification setup
│   │
│   ├── (auth)/                       # route group: unauthenticated screens
│   │   ├── _layout.tsx               # stack navigator; no tab bar
│   │   ├── sign-in.tsx               # /sign-in
│   │   ├── sign-up.tsx               # /sign-up
│   │   └── claim.tsx                 # /claim?token=… — claimable profile deep link
│   │
│   ├── (candidate)/                  # route group: candidate-only screens (role-gated)
│   │   ├── _layout.tsx               # tab navigator (Home · Score · Report · Account)
│   │   ├── index.tsx                 # /candidate — home dashboard
│   │   ├── mode.tsx                  # /candidate/mode — mode selection
│   │   ├── score/
│   │   │   ├── _layout.tsx           # stack navigator inside Score tab
│   │   │   ├── index.tsx             # /candidate/score — wizard entry
│   │   │   ├── fresher/
│   │   │   │   └── [step].tsx        # /candidate/score/fresher/:step (1…N)
│   │   │   ├── professional/
│   │   │   │   └── [step].tsx        # /candidate/score/professional/:step
│   │   │   └── review-extracted.tsx  # /candidate/score/review-extracted (Phase 2)
│   │   ├── report/
│   │   │   ├── index.tsx             # /candidate/report — score dashboard + charts
│   │   │   └── improvement.tsx       # /candidate/report/improvement
│   │   ├── documents/
│   │   │   ├── index.tsx             # /candidate/documents — list + upload (Phase 2/3)
│   │   │   └── capture.tsx           # /candidate/documents/capture — camera/picker flow
│   │   └── account/
│   │       ├── index.tsx             # /candidate/account — profile, settings
│   │       └── consent.tsx           # /candidate/account/consent — share management
│   │
│   ├── (employer)/                   # route group: employer/recruiter screens (role-gated)
│   │   ├── _layout.tsx               # tab navigator (Candidates · Settings)
│   │   ├── index.tsx                 # /employer — candidate list / submit
│   │   └── report/
│   │       └── [candidateId].tsx     # /employer/report/:candidateId
│   │
│   └── +not-found.tsx                # catch-all 404
│
├── components/                       # RN-specific components (NativeWind-styled)
├── hooks/                            # RN-specific hooks (notifications, secure store)
├── lib/                              # API client config, auth token helpers
└── assets/                           # icons, splash, adaptive-icon
```

The route groups `(auth)`, `(candidate)`, and `(employer)` mirror the Next.js route groups in `apps/web/src/app/`. Neither group segment appears in the URL; they exist purely to scope layouts and auth guards.

### 1.3 Root layout — auth gate

The root `_layout.tsx` is the single place that decides which route group is visible. It reads the auth state from secure storage (see §3), and uses `expo-router`'s `<Redirect>` to enforce gating before any screen renders:

```tsx
// apps/mobile/app/_layout.tsx
import { Slot, Redirect } from "expo-router";
import { useAuthStore } from "@/lib/auth-store";

export default function RootLayout() {
  const { token, role, isLoading } = useAuthStore();

  if (isLoading) return <SplashScreen />;   // wait for SecureStore read

  if (!token) return <Redirect href="/(auth)/sign-in" />;

  // Role-based redirect on first load
  if (role === "employer" || role === "recruiter") {
    return <Redirect href="/(employer)" />;
  }

  return <Slot />;  // renders the active route group layout
}
```

Deep-link handling for claim tokens (`/claim?token=…`) is registered in the Expo Router `linking` config and lands in `(auth)/claim.tsx`, which calls `POST /api/v1/profiles/claim` then redirects to `/(candidate)` after successful auth.

### 1.4 Stack vs tab navigators

| Location | Navigator | Reason |
|---|---|---|
| `(auth)/_layout` | Stack | Linear flow — sign-up then verify then continue |
| `(candidate)/_layout` | Bottom Tabs | Primary navigation for candidates: Home · Score · Report · Account |
| `(candidate)/score/_layout` | Stack inside Score tab | Multi-step wizard is a modal-stack flow |
| `(employer)/_layout` | Bottom Tabs | Simpler: Candidates list + Settings |

### 1.5 Typed route parameters

Expo Router generates typed `href` values from the file tree when `expo-router/types` is included. Use `useLocalSearchParams<{ step: string }>()` inside `[step].tsx` and `useGlobalSearchParams()` at the root layout for token deep links.

```tsx
// apps/mobile/app/(candidate)/score/fresher/[step].tsx
import { useLocalSearchParams, router } from "expo-router";

export default function FresherStep() {
  const { step } = useLocalSearchParams<{ step: string }>();
  const stepIndex = parseInt(step, 10);

  const handleNext = () => {
    router.push(`/(candidate)/score/fresher/${stepIndex + 1}`);
  };
  // …
}
```

---

## 2. Styling Parity via NativeWind

### 2.1 How NativeWind works

NativeWind applies Tailwind CSS utility classes to React Native's `StyleSheet` system at build time. Class names are identical to the web — `className="bg-background text-foreground p-4 rounded-lg"` — but resolve to `StyleSheet.create` objects on the native side, not CSS. This means the same token vocabulary is shared across `apps/web` (Tailwind) and `apps/mobile` (NativeWind) without any runtime CSS parser.

### 2.2 Shared design tokens

Design tokens live in `packages/types/src/design-tokens.ts` (or a shared Tailwind preset) and are consumed by both apps:

```ts
// packages/types/src/design-tokens.ts
// Extends the Tailwind preset used by both apps/web and apps/mobile

export const stabliColors = {
  // Tier colours — consistent on web and mobile
  unstable:       "#EF4444",   // red-500
  developing:     "#F97316",   // orange-500
  "somewhat-stable": "#EAB308", // yellow-500
  settled:        "#22C55E",   // green-500
  stable:         "#3B82F6",   // blue-500

  // Neutral palette
  background:     "#FFFFFF",
  foreground:     "#0A0A0A",
  muted:          "#F4F4F5",
  "muted-foreground": "#71717A",
  border:         "#E4E4E7",
  ring:           "#3B82F6",
} as const;

export type Tier = "unstable" | "developing" | "somewhat-stable" | "settled" | "stable";
export const tierColor = (tier: Tier): string => stabliColors[tier];
```

The shared Tailwind config at `packages/config/tailwind.preset.ts` extends `theme.colors` with these tokens; both `tailwind.config.ts` (web) and `tailwind.config.ts` (mobile, loaded by NativeWind's Metro plugin) extend this preset.

### 2.3 NativeWind setup

```ts
// apps/mobile/metro.config.js
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);
module.exports = withNativeWind(config, { input: "./global.css" });
```

```ts
// apps/mobile/babel.config.js
module.exports = {
  presets: ["babel-preset-expo"],
  plugins: ["nativewind/babel"],
};
```

```css
/* apps/mobile/global.css */
@tailwind base;
@tailwind components;
@tailwind utilities;
```

### 2.4 Platform-specific style overrides

Some platform differences need explicit handling via `Platform.select` or `.native.tsx` / `.web.tsx` file extensions. The rule is: **prefer identical class names first; split only when the visual or interaction model diverges**:

| Concern | Web (Tailwind) | Mobile (NativeWind) |
|---|---|---|
| Shadow | `shadow-md` (CSS box-shadow) | `shadow-md` (RN elevation — different rendering) |
| Text selection | Default | `selectable` prop |
| Safe area | Not needed | `SafeAreaView` or `useSafeAreaInsets()` |
| Scroll | `overflow-auto` | `<ScrollView>` |
| Input keyboard | Browser native | `keyboardType`, `returnKeyType` props |

---

## 3. Secure Auth Token Storage — `expo-secure-store`

**Rule: JWT tokens are NEVER stored in AsyncStorage.** AsyncStorage is unencrypted and accessible to any process on a rooted device. All secrets use `expo-secure-store`, which calls `Keychain` (iOS) and `EncryptedSharedPreferences` / `Keystore` (Android).

### 3.1 Token helpers

```ts
// apps/mobile/lib/token-store.ts
import * as SecureStore from "expo-secure-store";

const ACCESS_KEY = "stabil.access_token";
const REFRESH_KEY = "stabil.refresh_token";

export async function saveTokens(access: string, refresh: string): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_KEY, access),
    SecureStore.setItemAsync(REFRESH_KEY, refresh),
  ]);
}

export async function getAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(ACCESS_KEY);
}

export async function getRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(REFRESH_KEY);
}

export async function clearTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_KEY),
    SecureStore.deleteItemAsync(REFRESH_KEY),
  ]);
}
```

### 3.2 Auth store (Zustand)

```ts
// apps/mobile/lib/auth-store.ts
import { create } from "zustand";
import { getAccessToken, saveTokens, clearTokens } from "./token-store";
import type { Role } from "@stabil/types";

interface AuthState {
  token: string | null;
  role: Role | null;
  isLoading: boolean;
  init: () => Promise<void>;
  login: (access: string, refresh: string, role: Role) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  role: null,
  isLoading: true,

  init: async () => {
    const token = await getAccessToken();
    // Role is decoded from JWT payload — never stored separately
    const role = token ? decodeRole(token) : null;
    set({ token, role, isLoading: false });
  },

  login: async (access, refresh, role) => {
    await saveTokens(access, refresh);
    set({ token: access, role, isLoading: false });
  },

  logout: async () => {
    await clearTokens();
    set({ token: null, role: null });
  },
}));

function decodeRole(jwt: string): Role {
  const payload = JSON.parse(atob(jwt.split(".")[1]));
  return payload.role as Role;
}
```

### 3.3 API client — JWT injection

The shared API client in `packages/types/src/api-client.ts` accepts a `getToken` function so it works in both web (cookie/session) and mobile (SecureStore JWT) contexts without branching:

```ts
// apps/mobile/lib/api.ts
import { createApiClient } from "@stabil/types/api-client";
import { getAccessToken } from "./token-store";

export const api = createApiClient({
  baseUrl: process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3001",
  getToken: getAccessToken,
});
```

### 3.4 What NOT to store in SecureStore

- Large blobs (SecureStore has a ~2 KB limit per key on some platforms) — use the file system (`expo-file-system`) for draft payloads > 2 KB (see §7).
- Non-sensitive preferences (theme, onboarding flags) — use AsyncStorage for these; they are not secret.

---

## 4. Document & ID Capture — Phase 2/3

Resume upload (Phase 2) and government ID capture (Phase 3) require native device APIs that do not exist on the web. The mobile app uses three Expo libraries depending on the document type and source.

### 4.1 Library selection matrix

| Use case | Library | Phase | Notes |
|---|---|---|---|
| Resume PDF from device storage | `expo-document-picker` | 2 | Surfaces the OS file picker; filters to PDF + common image types |
| Resume or ID photo from camera | `expo-camera` | 2/3 | Live viewfinder; candidate frames the document and captures |
| Resume or ID photo from photo library | `expo-image-picker` | 2/3 | `launchImageLibraryAsync`; simpler than camera for existing photos |
| Government ID (Aadhaar, PAN, passport) | `expo-image-picker` or `expo-camera` | 3 | ID capture prefers camera for live capture; library picker as fallback |

### 4.2 Permission handling

All three libraries require runtime permissions. Request them lazily (at the moment the user taps "Upload" or "Capture"), not on app launch:

```ts
// apps/mobile/hooks/use-document-capture.ts
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { Camera } from "expo-camera";

export function useDocumentCapture() {
  async function pickFromLibrary() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") throw new Error("PERMISSION_DENIED");

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.9,
      allowsEditing: true,   // basic crop/straighten for ID photos
    });

    if (result.canceled) return null;
    return result.assets[0];
  }

  async function captureWithCamera() {
    const { status } = await Camera.requestCameraPermissionsAsync();
    if (status !== "granted") throw new Error("PERMISSION_DENIED");

    const result = await ImagePicker.launchCameraAsync({
      quality: 0.9,
      allowsEditing: true,
    });

    if (result.canceled) return null;
    return result.assets[0];
  }

  async function pickDocument() {
    const result = await DocumentPicker.getDocumentAsync({
      type: ["application/pdf", "image/jpeg", "image/png", "image/webp"],
      copyToCacheDirectory: true,   // needed to read the URI on Android
    });

    if (result.canceled) return null;
    return result.assets[0];
  }

  return { pickFromLibrary, captureWithCamera, pickDocument };
}
```

### 4.3 Capture UI — `(candidate)/documents/capture.tsx`

The capture screen is a bottom sheet with three options: **Camera**, **Photo Library**, and **Browse Files** (document picker). A brief preview is shown after selection before upload. For ID documents (Phase 3), a framing overlay (rectangle guide) is drawn over the camera viewfinder to help the candidate align the ID.

```tsx
// apps/mobile/app/(candidate)/documents/capture.tsx
import { View, Text, Pressable } from "react-native";
import { Image } from "expo-image";
import { useDocumentCapture } from "@/hooks/use-document-capture";
import { useUploadDocument } from "@/hooks/use-upload-document";

export default function CaptureScreen() {
  const { pickFromLibrary, captureWithCamera, pickDocument } = useDocumentCapture();
  const { upload, status } = useUploadDocument();

  async function handleSource(
    source: "camera" | "library" | "file"
  ) {
    const asset =
      source === "camera" ? await captureWithCamera()
      : source === "library" ? await pickFromLibrary()
      : await pickDocument();

    if (!asset) return;
    await upload(asset);   // §4.4 — presigned MinIO upload
  }

  return (
    <View className="flex-1 bg-background p-6 gap-4">
      <Text className="text-2xl font-bold text-foreground">Upload document</Text>
      <Pressable
        className="bg-primary rounded-lg p-4"
        onPress={() => handleSource("camera")}
      >
        <Text className="text-primary-foreground text-center">Use camera</Text>
      </Pressable>
      <Pressable
        className="border border-border rounded-lg p-4"
        onPress={() => handleSource("library")}
      >
        <Text className="text-foreground text-center">Choose from library</Text>
      </Pressable>
      <Pressable
        className="border border-border rounded-lg p-4"
        onPress={() => handleSource("file")}
      >
        <Text className="text-foreground text-center">Browse files</Text>
      </Pressable>
    </View>
  );
}
```

### 4.4 Presigned MinIO upload flow

The mobile client does **not** stream files through the API server. Instead it obtains a short-lived presigned PUT URL from the API and uploads directly to MinIO. This keeps the API server memory-light and upload throughput bounded only by the device and MinIO.

```ts
// apps/mobile/hooks/use-upload-document.ts
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useUploadDocument() {
  return useMutation({
    mutationFn: async (asset: { uri: string; mimeType?: string; name?: string }) => {
      // Step 1 — request a presigned PUT URL from the API
      const { uploadUrl, documentId } = await api.post(
        "/api/v1/documents/presigned-url",
        {
          fileName: asset.name ?? "document",
          mimeType: asset.mimeType ?? "application/octet-stream",
        }
      );

      // Step 2 — PUT directly to MinIO using the presigned URL
      await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": asset.mimeType ?? "application/octet-stream" },
        body: await readAsBlob(asset.uri),
      });

      // Step 3 — notify the API that the upload is complete
      await api.post(`/api/v1/documents/${documentId}/confirm-upload`);

      return documentId;
    },
  });
}

async function readAsBlob(uri: string): Promise<Blob> {
  // expo-file-system can read the local URI; convert to Blob for fetch
  const response = await fetch(uri);
  return response.blob();
}
```

The API endpoint `POST /api/v1/documents/presigned-url` calls MinIO's `presignedPutObject` with a 15-minute TTL and returns the URL + an in-progress `Document` record. On `confirm-upload`, the API triggers the downstream jobs (OCR for Phase 3, parsing for Phase 2). See [backend/modules/documents-storage.md](../backend/modules/documents-storage.md) for the server side.

**Security note:** presigned URLs are single-use in intent (TTL = 15 min). The API validates that `confirm-upload` is called by the same authenticated user who requested the URL, and immediately enqueues a virus-scan step before the document enters the review pipeline (SCOPE §11, [architecture/05-security-privacy.md](../architecture/05-security-privacy.md)).

---

## 5. Charts — victory-native / react-native-gifted-charts

Chart.js is a DOM library — it cannot run in React Native without a `WebView` shim, which introduces JavaScript bridge overhead and poor accessibility. The mobile app uses a native charting library instead. Both candidates produce **the same visual** — only the rendering implementation differs.

See [frontend/charts.md](charts.md) for the full chart catalogue, axis specs, and color mapping per block and per tier. This section covers mobile-specific implementation only.

### 5.1 Library choice

**`victory-native`** (Victory 41+ with Skia renderer) is the recommended default. It renders to `@shopify/react-native-skia`, which runs entirely on the UI thread with no JS bridge stall. The API is prop-based and close to the web Chart.js mental model (data arrays, axis labels, color arrays).

`react-native-gifted-charts` is a lighter alternative if Skia is a build-size concern — it renders to SVG via `react-native-svg`. Use it for sparklines and simple bar charts; prefer Victory for the radar (spider) chart.

### 5.2 Bar chart — score by block

The block breakdown bar chart (common / mode / verification) maps directly to a `VictoryBar` chart in a `VictoryChart` container:

```tsx
// apps/mobile/components/charts/block-bar-chart.tsx
import { VictoryBar, VictoryChart, VictoryAxis, VictoryLabel } from "victory-native";
import type { ScoreBlock } from "@stabil/types";
import { stabliColors } from "@stabil/types/design-tokens";

interface Props {
  blocks: ScoreBlock[];   // [{ label: "Mode", awarded: 420, max: 700 }, …]
}

export function BlockBarChart({ blocks }: Props) {
  const data = blocks.map((b, i) => ({ x: b.label, y: b.awarded, fill: BLOCK_COLORS[i] }));

  return (
    <VictoryChart domainPadding={20} height={220}>
      <VictoryAxis style={{ tickLabels: { fontSize: 11, fill: stabliColors.foreground } }} />
      <VictoryAxis dependentAxis tickFormat={(t) => String(t)} />
      <VictoryBar data={data} style={{ data: { fill: ({ datum }) => datum.fill } }} />
    </VictoryChart>
  );
}

const BLOCK_COLORS = ["#3B82F6", "#22C55E", "#F97316"]; // mode · common · verification
```

### 5.3 Radar chart — parameter breakdown

The parameter radar (spider) chart shows the candidate's relative performance across scored parameters. Use `VictoryRadar` (Victory 41+) or a polar `VictoryChart` with `VictoryArea`:

```tsx
// apps/mobile/components/charts/parameter-radar-chart.tsx
import { VictoryChart, VictoryArea, VictoryPolarAxis } from "victory-native";
import type { ParameterScore } from "@stabil/types";

interface Props {
  parameters: ParameterScore[];  // candidate-visible parameters only (visibility: "all")
}

export function ParameterRadarChart({ parameters }: Props) {
  const data = parameters.map((p) => ({
    x: p.label,
    y: p.awarded / p.max,  // normalized to [0,1]
  }));

  return (
    <VictoryChart polar height={260} domain={{ y: [0, 1] }}>
      {parameters.map((p) => (
        <VictoryPolarAxis key={p.key} dependentAxis={false} tickFormat={() => p.label} />
      ))}
      <VictoryArea
        data={data}
        style={{ data: { fill: "#3B82F680", stroke: "#3B82F6", strokeWidth: 2 } }}
      />
    </VictoryChart>
  );
}
```

**Sensitive-parameter note:** the radar only receives `visibility: "all"` parameters (age, marital status are never included in the candidate's chart data). The `filterForAudience` call happens server-side; the client renders only what the API returns (SCOPE §6.3).

### 5.4 Score history line chart

The re-scoring improvement loop (SCOPE §11) is shown as a line chart of `total` per `ScoreRun` over time:

```tsx
import { VictoryLine, VictoryChart, VictoryAxis } from "victory-native";

<VictoryChart height={180}>
  <VictoryAxis tickFormat={(d) => new Date(d).toLocaleDateString("en-IN", { month: "short" })} />
  <VictoryAxis dependentAxis domain={[0, 1500]} />
  <VictoryLine
    data={scoreHistory.map((run) => ({ x: run.createdAt, y: run.total }))}
    style={{ data: { stroke: "#3B82F6", strokeWidth: 2 } }}
  />
</VictoryChart>
```

---

## 6. Push Notifications — `expo-notifications`

Push notifications surface three Stabil events (SCOPE §9, SCOPE §6.1): **score ready** (async scoring completes), **claim invite** (employer submits a candidate), and **consent request** (recruiter asks to view a report). All three are wired through the API's `notifications` module ([backend/modules/notifications.md](../backend/modules/notifications.md)).

### 6.1 Registration flow

Expo push tokens are obtained at login and sent to the API for storage on the `User` record. Tokens must be refreshed when they change (e.g. OS reissues a token after reinstall):

```ts
// apps/mobile/lib/push-registration.ts
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { api } from "./api";

export async function registerPushToken(): Promise<void> {
  // Permission request — must happen in response to a user gesture or early in the session
  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    // Graceful degradation — the app works without push; in-app polling covers it
    return;
  }

  const tokenData = await Notifications.getExpoPushTokenAsync({
    projectId: Constants.expoConfig?.extra?.eas?.projectId,
  });

  await api.post("/api/v1/accounts/push-token", { token: tokenData.data });
}
```

`registerPushToken()` is called in `_layout.tsx` after auth state is confirmed (i.e. after `useAuthStore().init()` resolves with a valid token). This ensures the API call is authenticated.

### 6.2 Notification handlers

```ts
// apps/mobile/app/_layout.tsx (excerpt — notification wiring)
import * as Notifications from "expo-notifications";
import { router } from "expo-router";

// Foreground handler — show a banner; tapping navigates to the relevant screen
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});

// Response handler — fired when user taps a notification
Notifications.addNotificationResponseReceivedListener((response) => {
  const { type, id } = response.notification.request.content.data as {
    type: "score_ready" | "claim_invite" | "consent_request";
    id: string;
  };

  switch (type) {
    case "score_ready":
      router.push("/(candidate)/report");
      break;
    case "claim_invite":
      router.push(`/(auth)/claim?token=${id}`);
      break;
    case "consent_request":
      router.push("/(candidate)/account/consent");
      break;
  }
});
```

### 6.3 Consent for notifications

Notification permission is requested **once**, lazily (not on cold launch), with a clear explanation of what each notification type means — per iOS App Store guidelines and Android notification policy. If the user declines, in-app polling via TanStack Query covers score-ready events on the report screen.

### 6.4 Notification payload shape

The API sends Expo push notifications via the Expo Push Notifications API (not direct APNs/FCM — Expo's proxy manages tokens). Payload:

```jsonc
{
  "to": "ExponentPushToken[…]",
  "title": "Your stability score is ready",
  "body": "You scored 1180 / 1500 — Settled. Tap to view your report.",
  "data": { "type": "score_ready", "id": "01hx…" }
}
```

---

## 7. Offline / Draft Persistence for the Wizard

The multi-step scoring wizard can be interrupted (call, app background, OS kill). Partial answers are persisted locally so the candidate resumes exactly where they left off without losing data.

### 7.1 Storage strategy

| Data | Size | Store | Reason |
|---|---|---|---|
| Wizard draft (form answers) | 1–20 KB | `expo-file-system` (JSON file) | Larger than SecureStore 2 KB limit; not a secret |
| Draft metadata (mode, step index, last-updated) | < 100 B | `AsyncStorage` | Fast lookup without reading full file |
| Auth tokens | < 2 KB | `expo-secure-store` | Secret — never in AsyncStorage or file system |

### 7.2 Draft file location

```ts
// apps/mobile/lib/wizard-draft.ts
import * as FileSystem from "expo-file-system";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { WizardDraft } from "@stabil/types";

const DRAFT_DIR = FileSystem.documentDirectory + "drafts/";
const DRAFT_META_KEY = "stabil.wizard_draft_meta";

export async function saveDraft(profileId: string, draft: WizardDraft): Promise<void> {
  await FileSystem.makeDirectoryAsync(DRAFT_DIR, { intermediates: true });
  const path = DRAFT_DIR + `${profileId}.json`;
  await FileSystem.writeAsStringAsync(path, JSON.stringify(draft));
  await AsyncStorage.setItem(
    DRAFT_META_KEY,
    JSON.stringify({ profileId, step: draft.currentStep, updatedAt: new Date().toISOString() })
  );
}

export async function loadDraft(profileId: string): Promise<WizardDraft | null> {
  const path = DRAFT_DIR + `${profileId}.json`;
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists) return null;
  const raw = await FileSystem.readAsStringAsync(path);
  return JSON.parse(raw) as WizardDraft;
}

export async function clearDraft(profileId: string): Promise<void> {
  const path = DRAFT_DIR + `${profileId}.json`;
  await FileSystem.deleteAsync(path, { idempotent: true });
  await AsyncStorage.removeItem(DRAFT_META_KEY);
}
```

### 7.3 WizardDraft type

```ts
// packages/types/src/wizard-draft.ts
import type { Mode } from "@stabil/types";

export interface WizardDraft {
  profileId: string;
  mode: Mode;
  currentStep: number;
  totalSteps: number;
  /** Partial answers keyed by parameter key — matches the Zod form schema */
  answers: Record<string, unknown>;
  lastUpdatedAt: string; // ISO 8601
}
```

### 7.4 Draft lifecycle in the wizard

```mermaid
flowchart TD
  A([Candidate opens Score tab]) --> B{Draft exists\nin AsyncStorage?}
  B -- yes --> C[Show "Resume your draft" banner\nwith last-updated timestamp]
  B -- no --> D[Start fresh wizard from step 1]
  C --> E{User choice}
  E -- resume --> F[loadDraft → pre-fill form state → go to currentStep]
  E -- discard --> G[clearDraft → start fresh]
  F --> H[User edits form fields]
  D --> H
  H --> I[Auto-save: saveDraft on every step advance\n+ debounced field change]
  I --> H
  H --> J{Wizard submitted?}
  J -- yes --> K[POST /api/v1/scores → clearDraft on success]
  J -- no/abandoned --> I
```

Auto-save fires on every step navigation and on a 2-second debounce from any field change. The draft is cleared only on successful score submission to prevent data loss from network errors.

---

## 8. Web ↔ Mobile Parity Matrix

This table records the expected state at Phase 1 completion, with Phase 2/3 call-outs. "Parity" means the feature is functionally equivalent, not pixel-identical — native idioms (bottom sheets, haptics, swipe navigation) are preferred over forcing web patterns onto mobile.

| Feature | Web (Next.js) | Mobile (Expo/RN) | Notes |
|---|---|---|---|
| **Sign up / sign in** | `/sign-in`, `/sign-up` — form + session cookie | `(auth)/sign-in.tsx`, `sign-up.tsx` — JWT in SecureStore | Same Zod schema; same API endpoint |
| **Role selection** | Shown at sign-up; persisted in JWT | Same | `Role = candidate\|employer\|recruiter\|admin` |
| **Claim profile (deep link)** | `/claim?token=…` — query param | `/(auth)/claim.tsx` — Expo Router deep link | Both call `POST /api/v1/profiles/claim` |
| **Mode selection** | `/score/mode` — page with cards | `/(candidate)/mode.tsx` — full-screen card picker | Identical API; identical Zod validation |
| **Fresher wizard** | Multi-step form with URL-tracked steps | Stack navigator with `[step].tsx` | Same Zod schemas from `@stabil/types`; same API payload |
| **Professional wizard** | Same as above | Same as above | Same |
| **Resume upload** | Drag-and-drop + file input | `expo-document-picker` + `expo-image-picker` | **Phase 2**; presigned MinIO upload (§4.4) |
| **ID / verification upload** | File input | `expo-camera` + `expo-image-picker` with framing overlay | **Phase 3**; same presigned upload flow |
| **Parsed-data review step** | Inline wizard step (shadcn/ui form) | Same wizard step (NativeWind form) | **Phase 2**; same `ExtractedResume` type |
| **Score dashboard** | `/report` — Chart.js charts | `/(candidate)/report/index.tsx` — victory-native charts | Same `ScoreResult` data shape; see §5 and [charts.md](charts.md) |
| **Block bar chart** | `react-chartjs-2` Bar | `VictoryBar` | Same token colors; same data |
| **Parameter radar chart** | `react-chartjs-2` Radar | `VictoryArea` polar | Candidate-visible params only (SCOPE §6.3) |
| **Score history line chart** | `react-chartjs-2` Line | `VictoryLine` | Re-scoring improvement loop (SCOPE §11) |
| **PDF download** | In-browser download via presigned URL | `expo-sharing` + open presigned URL | Same PDF from `@react-pdf/renderer` server-side |
| **Improvement guidance** | Inline guidance panel | Same content, native card layout | Same API response (`improvementHints[]`) |
| **Employer report view** | `/employer/report/[id]` | `/(employer)/report/[candidateId].tsx` | Full breakdown including sensitive attrs (SCOPE §6.3) |
| **Per-share consent** | Consent modal + `/account/consent` | `/(candidate)/account/consent.tsx` — native action sheet | Same API (`POST /api/v1/share-requests/:id/consent`) |
| **Consent revocation** | Settings page toggle | Same screen | Same endpoint |
| **Account / profile edit** | `/account` | `/(candidate)/account/index.tsx` | Same |
| **Data deletion request** | `/account/settings` | Same screen | `DELETE /api/v1/accounts/me` |
| **Re-scoring** | "Recalculate" button on report | Same button | Creates new `ScoreRun`; draft cleared |
| **Push notifications** | Not applicable (web push optional, later) | `expo-notifications` — score ready, claim invite, consent request | **Mobile-only** in Phase 1; web push deferred |
| **Offline wizard drafts** | Browser `localStorage` (sessionStorage fallback) | `expo-file-system` + `AsyncStorage` for metadata | Mobile uses file system for drafts > 2 KB |
| **Admin document review** | `/admin/documents` (web-only) | Not on mobile (admin console is web-only) | Admin tooling is desktop-class; no mobile parity needed |
| **Employer multi-candidate dashboard** | Phase 4 | Phase 4 | Desktop-class UI; mobile view TBD in Phase 4 |

---

## 9. Shared vs Platform-Specific Code

### 9.1 What is shared (monorepo packages)

These packages are imported identically by `apps/web`, `apps/mobile`, and `apps/api`:

| Package | Contents | Used by |
|---|---|---|
| `@stabil/types` | Zod schemas (form, API DTO, parse output), TypeScript types (`Mode`, `Tier`, `Audience`, `Role`, `ScoreResult`, `WizardDraft`, design tokens, API client factory) | web · mobile · api |
| `@stabil/scoring` | Pure scoring engine (`computeScore`, `mapTier`, `filterForAudience`), domain types | web · mobile · api |
| `@stabil/core` | Rubric layer: raw answers → `[0,1]` fractions | api (primary); mobile can call it locally for a preview score without a network round-trip |
| Zod validation | Same schema parse call — `WizardFormSchema.parse(answers)` — runs identically in RN | web · mobile |
| API client factory | `createApiClient({ baseUrl, getToken })` — returns typed fetch wrappers | web · mobile |
| Error types / problem+json | RFC 9457 error shape, typed error classes | web · mobile |

> **Engine boundary reminder (README):** `@stabil/scoring` consumes normalized fractions `[0,1]`. Mapping raw form answers → fractions is `@stabil/core` (the rubric layer). Both packages are pure TypeScript with no I/O, so they run in React Native without polyfills.

### 9.2 What is platform-specific

| Concern | Web implementation | Mobile implementation |
|---|---|---|
| **UI components** | shadcn/ui (Radix + Tailwind) | Custom NativeWind components; no shadcn/ui on RN |
| **Charts** | `react-chartjs-2` + Chart.js | `victory-native` (Skia) or `react-native-gifted-charts` |
| **Navigation** | Next.js App Router (`<Link>`, `redirect()`) | Expo Router (`router.push()`, `<Redirect>`) |
| **Auth token storage** | Session cookie (Next.js `httpOnly`) | `expo-secure-store` (§3) |
| **File upload / capture** | `<input type="file">`, drag-and-drop | `expo-document-picker`, `expo-image-picker`, `expo-camera` |
| **PDF open** | `<a href download>` or `window.open` | `expo-sharing` + `Linking.openURL` |
| **Offline drafts** | `localStorage` | `expo-file-system` + `AsyncStorage` |
| **Push notifications** | Not in Phase 1 | `expo-notifications` |
| **Safe area** | Not needed | `react-native-safe-area-context` |
| **Keyboard handling** | Browser native | `KeyboardAvoidingView`, `keyboardType` prop |
| **Haptics** | Not standard | `expo-haptics` for form submission feedback |
| **SSR / SEO** | Next.js SSR, `<Head>` meta | Not applicable |

### 9.3 Forbidden patterns

- **Never import `next/*` from `apps/mobile`** — and vice versa for `react-native` in `apps/web`.
- **Never re-implement the scoring math in either client** — always delegate to `@stabil/core` (rubric) + `@stabil/scoring` (engine), or call the API. Two score implementations will drift.
- **Never store JWT in `AsyncStorage`** — exclusively `expo-secure-store` (§3).
- **Never call OpenRouter, MinIO, or any external service directly from the mobile app** — all I/O goes through `/api/v1`.

---

## 10. EAS Build & Submit Basics

Expo Application Services (EAS) is the standard build and submission pipeline (SCOPE §10 "Deploy: Expo EAS"). The following covers the structure and workflow; environment-specific secrets and CI wiring are in [CLOUD.md](../CLOUD.md).

### 10.1 `eas.json`

```jsonc
// apps/mobile/eas.json
{
  "cli": { "version": ">= 12.0.0" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "env": {
        "EXPO_PUBLIC_API_URL": "http://localhost:3001"
      }
    },
    "preview": {
      "distribution": "internal",
      "channel": "preview",
      "env": {
        "EXPO_PUBLIC_API_URL": "https://api.staging.stabil.app"
      }
    },
    "production": {
      "distribution": "store",
      "channel": "production",
      "env": {
        "EXPO_PUBLIC_API_URL": "https://api.stabil.app"
      }
    }
  },
  "submit": {
    "production": {
      "ios": { "appleId": "developer@teacherop.com", "ascAppId": "…" },
      "android": { "serviceAccountKeyPath": "./google-play-key.json", "track": "internal" }
    }
  }
}
```

### 10.2 Build profiles

| Profile | Purpose | Distribution | OTA updates |
|---|---|---|---|
| `development` | Local dev with `expo-dev-client` | Internal (QR code) | No |
| `preview` | Staging builds for QA; TestFlight / internal track | Internal | Yes (channel: `preview`) |
| `production` | App Store / Google Play submission | Store | Yes (channel: `production`) |

### 10.3 Common EAS commands

```bash
# Install EAS CLI globally
pnpm add -g eas-cli

# Log in
eas login

# Build for development (creates a dev client build)
eas build --profile development --platform all

# Build a preview build for staging
eas build --profile preview --platform all

# Submit a production build to both stores
eas submit --platform all --profile production

# Publish an OTA update (JS bundle only — no new native build required)
eas update --branch production --message "Fix: wizard draft not clearing on submit"
```

### 10.4 Environment variables

Expo's `EXPO_PUBLIC_*` prefix makes variables available to the JS bundle at build time (analogous to `NEXT_PUBLIC_*` on the web app). Secrets that must not be embedded in the bundle (e.g. signing keys) are configured in the EAS dashboard under **Secrets** and are never committed to the repository.

| Variable | Where set | Purpose |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | `eas.json` per profile | API base URL |
| `EXPO_PUBLIC_EAS_PROJECT_ID` | `eas.json` / `app.json` | Required for `expo-notifications` push token generation |
| App signing keys (iOS `.p12`, Android `keystore`) | EAS Secrets dashboard | Never in repository |

### 10.5 OTA (over-the-air) updates

EAS Update allows shipping JS bundle changes without a full store review — suitable for bug fixes, copy changes, and new feature flags that do not require new native modules. The rule: **any new Expo SDK module (e.g. adding `expo-camera` for Phase 2) requires a new native build**. JS-only changes (new screen, form field, chart change) can ship as OTA updates to the `preview` or `production` channel.

### 10.6 App config (`app.json` / `app.config.ts`)

```ts
// apps/mobile/app.config.ts
import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "Stabil",
  slug: "stabil",
  version: "1.0.0",
  scheme: "stabil",          // deep-link URI scheme: stabil://…
  icon: "./assets/icon.png",
  splash: { image: "./assets/splash.png", resizeMode: "contain", backgroundColor: "#FFFFFF" },
  ios: {
    supportsTablet: false,
    bundleIdentifier: "app.stabil.mobile",
    infoPlist: {
      // Camera usage description — required for Phase 2/3 document capture
      NSCameraUsageDescription:
        "Stabil uses the camera so you can photograph your resume or government ID for upload.",
      NSPhotoLibraryUsageDescription:
        "Stabil accesses your photos so you can select a document to upload.",
    },
  },
  android: {
    package: "app.stabil.mobile",
    adaptiveIcon: { foregroundImage: "./assets/adaptive-icon.png", backgroundColor: "#FFFFFF" },
    permissions: ["CAMERA", "READ_EXTERNAL_STORAGE"],
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-notifications",
    ["expo-camera", { "cameraPermission": "Allow Stabil to access the camera for document capture." }],
    ["expo-image-picker", { "photosPermission": "Allow Stabil to access photos for document upload." }],
  ],
  extra: {
    eas: { projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID },
  },
};

export default config;
```

**Phase gating for native plugins:** `expo-camera` and `expo-image-picker` are listed in `plugins` from Phase 0 (they incur minimal native overhead), but their UI entry points are hidden behind a feature flag (`EXPO_PUBLIC_PHASE >= 2`) until Phase 2 is active. This avoids a native rebuild when Phase 2 ships.

---

## Appendix A — Key dependencies

| Package | Version constraint | Purpose |
|---|---|---|
| `expo` | `~52.x` | Core SDK |
| `expo-router` | `~4.x` | File-based navigation |
| `expo-secure-store` | `~14.x` | Auth token storage (§3) |
| `expo-image-picker` | `~16.x` | Photo library + camera launch (§4) |
| `expo-camera` | `~16.x` | Camera viewfinder with overlay (§4) |
| `expo-document-picker` | `~12.x` | OS file picker for PDFs (§4) |
| `expo-file-system` | `~18.x` | Wizard draft persistence (§7) |
| `expo-notifications` | `~0.29.x` | Push notifications (§6) |
| `expo-haptics` | `~14.x` | Form submission haptic feedback |
| `expo-sharing` | `~12.x` | PDF open / share sheet |
| `nativewind` | `^4.x` | Tailwind utility classes for RN (§2) |
| `victory-native` | `^41.x` | Skia-backed charts (§5) |
| `@shopify/react-native-skia` | `^1.x` | Skia renderer required by victory-native |
| `@tanstack/react-query` | `^5.x` | Server state, mutations (shared with web) |
| `react-hook-form` | `^7.x` | Form state (shared with web) |
| `zod` | `^3.x` | Validation (shared with web + API) |
| `zustand` | `^5.x` | Auth store, local UI state |
| `@react-native-async-storage/async-storage` | `^2.x` | Non-secret preferences + draft metadata |
| `react-native-safe-area-context` | `^4.x` | Safe area insets |
| `react-native-screens` | `^3.x` | Native screen optimization for Expo Router |

---

## Appendix B — Accepted divergence from web

These are intentional differences, not bugs:

1. **No server-side rendering.** The mobile app is always client-rendered. SEO is a web concern only.
2. **No `@react-pdf/renderer` in the mobile bundle.** PDF generation is server-side; the mobile app only downloads and opens the presigned URL.
3. **Admin screens are web-only.** The admin document review queue is a desktop-class UI; no mobile equivalent is planned.
4. **Chart library differs.** Chart.js (web) vs victory-native (mobile). The data shapes and color tokens are identical — only the renderer changes.
5. **Navigation model differs.** Next.js `<Link>` / `router.push()` vs Expo Router `router.push()`. Both are file-system-based; the APIs are close but not identical.
