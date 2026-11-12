---
name: mobile-app-creator
description: >
  Mobile application builder that takes a product from empty folder to store
  release. It selects the right stack (React Native vs Flutter vs native
  Swift/Kotlin), scaffolds Expo or bare projects with feature-based
  architecture, builds screens with React Navigation and typed params, wires
  state (useState/useReducer, Context, zustand, Riverpod), implements the
  networking layer (axios/dio clients with auth headers, timeouts, retry, and
  a full error taxonomy), chooses storage correctly (AsyncStorage vs
  SecureStore vs SQLite), and integrates platform capabilities: push
  notifications (FCM/APNs), deep links, permissions with rationale screens,
  and app lifecycle handling. It also covers performance tuning (FlatList
  props, Hermes, memoization, startup time), the testing pyramid (Jest,
  React Native Testing Library, Detox/Maestro), Android signing and Play
  release, iOS certificates, TestFlight and App Store review survival,
  versionCode discipline, OTA updates via EAS, and Sentry/Crashlytics
  monitoring. Use this whenever the user says "build me an app", "create a
  React Native app", "make a Flutter app", "add push notifications",
  "publish to the App Store or Play Store", "fix this RN performance
  problem", "set up login for mobile", "make it work offline", or "ship an
  update". Do NOT use it for UI/UX design exploration, wireframes, or design
  systems — that is mobile-app-designer's job; for websites use
  website-creator; for games use game-creator.
---

# Mobile App Creator

> Ship production mobile apps: pick the stack, structure the code, wire data and platform services, survive store review.

## 0. Operating Rules (Non-Negotiable)

1. ALWAYS select the stack through the Section 6 decision table and write the rationale down. NEVER default to native "because it's better" or cross-platform "because it's faster" without checking team skills, native-feature needs, and timeline. Why: the stack decision is the most expensive one to reverse.
2. NEVER store auth tokens, refresh tokens, or any secret in plain storage (AsyncStorage/SharedPreferences). MUST use expo-secure-store / Keychain / Keystore. Why: plain app storage is readable on rooted devices and in unencrypted backups.
3. NEVER trust client input. MUST validate on the server too, and re-validate anything coming back from deep links or push payloads. Why: any client can be modified; the client is a suggestion, the server is the authority.
4. MUST set network timeouts (10–15s) and map every error class (network / server / auth / validation) to a designed UI state. NEVER let a request fail silently. Why: silent failures become "the app is broken" reviews.
5. MUST use FlatList/SectionList (or FlashList) with tuned props for long lists. NEVER render hundreds of items with `.map()` inside a ScrollView. Why: it mounts every row, exhausting memory and freezing the JS thread.
6. MUST bump `versionCode` (Android) / `CFBundleVersion` build number (iOS) on EVERY upload and never reuse a number. Why: both stores reject duplicate or lower build numbers, and mismatched versions break staged rollouts.
7. MUST request permissions in context — at the moment the user performs the action that needs them, after a rationale — and MUST handle both denied and permanently-denied states (open Settings path). Why: cold-launch permission prompts are the top cause of permanent denials.
8. MUST profile before optimizing (React DevTools profiler, Flipper/Perfetto, Flutter DevTools). NEVER optimize on speculation. Why: the actual bottleneck is almost never the guessed one, and speculative rewrites add bugs.
9. ALWAYS run the release QA matrix (Section 4.14): airplane mode, permission denied, fresh install, upgrade install, tiny and huge screens, dark mode, interruption. Why: every one of these is a top-grossing 1-star review category.
10. NEVER commit secrets (API keys, keystores, service accounts) to the repo. Use environment config per build channel (EAS secrets, `--dart-define`, Xcode configurations). Why: leaked keys in public repos are scanned within minutes.
11. MUST wire crash reporting (Sentry or Crashlytics) before the first external build. Why: you cannot fix crashes you cannot see; crash-free-session rate is the first health metric of any release.
12. MUST implement an offline behavior for every core flow (cache-then-network or queue). Why: mobile networks drop constantly; an app that whitescreens offline feels broken even when online features are fine.

## 1. When to Use / When Not To

Use this skill when:
- Building a new mobile app or adding features to one (screens, navigation, state)
- Wiring networking, storage, auth, push notifications, deep links, or permissions
- Tuning performance (lists, startup, memory, bundle size)
- Setting up tests (unit/component/E2E), CI builds, signing, and store releases
- Shipping OTA updates or planning rollout/monitoring

Do NOT use this skill when:
- The ask is wireframes, flows, or design systems → **mobile-app-designer**
- The target is a website or PWA → **website-creator**
- The product is a game → **game-creator**
- The work is backend/API only → backend/fullstack skills

| Request contains | Route to |
|---|---|
| "Design the screens", "make wireframes" | mobile-app-designer |
| "Build/ship the app", "fix this crash", "publish it" | **mobile-app-creator** (this skill) |
| "It's a game" | game-creator |
| Design + build requested | Designer output first, then this skill implements it |

## 2. Core Concepts & Mental Models

- **React Native** = JS/TS code driving real native views. Old architecture used an async bridge; the New Architecture (JSI + Fabric + TurboModules) is synchronous where it matters. Mentally: "my JS objects describe UI; native owns rendering."
- **Flutter** = Dart code painting every pixel itself via Impeller/Skia. Nothing is a native widget — consistency across platforms is perfect, platform look must be opted into (Cupertino/Material). Mentally: "everything is a widget; the tree rebuilds to update UI."
- **Declarative UI**: UI = f(state). You never mutate views; you change state and re-render. Debugging = finding which state is wrong, not which view.
- **Props down, events up**: data flows from parent to child; children communicate back through callbacks. Crossing these directions is how tangles start.
- **Local vs global state**: `useState`/`useReducer` for component-local; Context or zustand/Riverpod for cross-screen (auth, theme, cart). NEVER put everything global — it kills re-renders and testability.
- **Navigation as a stack of screens** with typed params: screens are pushed and popped; params are the contract between them.
- **Platform divergence**: `Platform.OS`, `.ios.tsx`/`.android.tsx` files, and conditional styles are normal; pretending platforms are identical produces uncanny-valley UIs.
- **Store release ≠ dev run**: a build must be signed, versioned, and stripped of dev endpoints. The gap between `npx react-native run-ios` and "live on the App Store" is where all the process in Section 4.13 lives.

## 3. Mandatory Workflow

1. **Decide the stack.** Fill the Section 6 framework table with the project's actual team/platform/feature/timeline facts; write one paragraph of rationale. MUST confirm any native-only requirement (widgets, watch apps, heavy AR) before choosing cross-platform.
2. **Scaffold.** React Native: `npx create-expo-app@latest myapp` (managed Expo unless a native module forces bare). Flutter: `flutter create myapp`. Set up TypeScript if RN, lint, and the feature-folder structure from 4.8 on day one.
3. **Implement the design tokens.** Consume the designer's token JSON (from mobile-app-designer) into a theme module. NEVER hardcode hex values in screens.
4. **Build the navigation skeleton.** Install `@react-navigation/native` + `native-stack` + `bottom-tabs`; define all screens with typed params before styling them. Why: navigation shapes state flow; retrofitting it is painful.
5. **Build the services layer first.** API client (5.1), storage wrappers (5.2), and auth store before screens that need them. Why: screens assembled on untested data layers get rewritten.
6. **Implement screens state-first.** For each screen: define its states (loading/empty/error/content) from the design spec, then build content. NEVER ship a screen that only renders the happy path.
7. **Wire platform services** (push, deep links, permissions, camera) using the Section 4.9 patterns; test denied/blocked states for every permission.
8. **Test the pyramid.** Unit-test services and stores, component-test screens with React Native Testing Library, one E2E happy path with Maestro. Run on every PR.
9. **Run the QA matrix** (Section 4.14) on real devices — one small Android, one small iOS at minimum.
10. **Build & release.** Android: keystore + signing config + AAB + Play listing assets. iOS: certificates/profiles + TestFlight + review. Follow 4.13 exactly; version bumps on every upload.
11. **Roll out and monitor.** Staged rollout (10% → 50% → 100% on Play), watch crash-free sessions ≥ 99.5% and Sentry issues; keep OTA (EAS Update) for JS-only fixes.
12. **Iterate.** Triage crashes by user impact, feed findings back into the backlog, and keep the cut-list discipline for v2.

## 4. Deep Knowledge Library

### 4.1 Stack Decision Factors

Score these five factors before choosing: **team skills** (what does the team already ship in?), **target platforms** (iOS+Android only, or web/desktop later?), **native feature depth** (widgets/watch/AR push toward native), **timeline** (cross-platform halves the UI work for CRUD apps), **app type** (content/CRUD → cross-platform shines; camera/games/heavy graphics → native or game engines). A CRUD-style app with a JS team and a 3-month deadline is the textbook React Native/Expo case. A pixel-perfect platform showpiece with deep sensor work is the native case. Flutter wins when brand-consistent UI across platforms matters more than native texture, or the team is Dart-first.

### 4.2 Expo vs Bare Workflow (React Native)

- **Expo managed (default choice)**: `create-expo-app`, EAS Build cloud builds, EAS Update OTA, expo-camera/location/notifications modules, no Xcode/Android Studio needed day-to-day. Choose it unless a requirement is on the "bare only" list.
- **Bare workflow**: full native projects, needed for custom native modules not covered by Expo SDK, heavy native build customization, or integrating into existing native apps. You keep react-navigation, zustand, etc. — only the toolchain changes.
- Decision rule: start managed; eject only when a concrete native requirement blocks you. NEVER eject preemptively — EAS config files (`app.json`, `eas.json`) are cheaper than native build maintenance.

### 4.3 React Native Core Components & Styling

- Core set: `View` (div), `Text` (every text MUST be inside `Text`), `ScrollView` (all children mounted — small areas only), `FlatList` (virtualized — all lists), `Pressable` (touchable with state callbacks), `TextInput`, `Image` (remote images need explicit dimensions), `Modal`, `ActivityIndicator`.
- Styling: `StyleSheet.create({...})` — a JavaScript subset of CSS (flexbox by default: `flexDirection: 'column'`); no inheritance — style every `Text`. Use tokens from the theme module; safe areas via `react-native-safe-area-context`'s `useSafeAreaInsets()`.
- Pressed/focus states: `Pressable` accepts `style={({ pressed }) => [...]}`; accessibility via `accessibilityRole`, `accessibilityLabel`, `accessibilityState`.
- NEVER use percentage heights without a sized parent; NEVER let `Text` overflow without `numberOfLines`.

### 4.4 Navigation with React Navigation

- Stack (`@react-navigation/native-stack`) for hierarchy; tabs (`@react-navigation/bottom-tabs`) for top-level peers; nest stacks inside tabs — the standard app skeleton (5.3).
- Typed params: `type RootStackParamList = { Detail: { id: string } }` and `NativeStackScreenProps<RootStackParamList, 'Detail'>`; pass minimal IDs, fetch inside the target screen. NEVER pass whole objects that can go stale.
- Modals: `presentation: 'modal'` (iOS card) or `'fullScreenModal'`; deep links map URL → screen via `linking` config; state restoration via `navigationRef`. Back behavior is the system's — NEVER block back without an explicit confirm flow.

### 4.5 State Management Patterns

- Ladder, in order: `useState` → `useReducer` (multi-field transitions) → Context (low-frequency global: theme, auth) → **zustand** (frequent-updates global store; selectors prevent over-render) → Redux Toolkit (large teams needing middleware/DevTools conventions).
- Server state ≠ client state: consider TanStack Query for fetching/caching/retrying server data before writing manual loading flags.
- Rules: one store per domain (auth, cart, settings); select narrow slices (`useAuth(s => s.userId)`); NEVER mirror server data into two stores; derived values are computed, not stored.

### 4.6 Networking Layer

Client pattern (5.1 implements it): one configured axios/dio instance per environment (`EXPO_PUBLIC_API_URL`), auth header injected by an interceptor reading SecureStore, 15s timeout, retry with exponential backoff **for idempotent GET only**, and an error taxonomy: `network` (no connection/timeout) → offline UI; `auth` (401) → re-login flow + token refresh; `server` (5xx) → "try again shortly"; `validation` (4xx) → field-level messages. Every screen renders all four. MUST validate server responses (zod/valibot parse) before entering state. NEVER trust push payloads or deep-link params as authenticated input without server verification.

### 4.7 Storage Matrix

| Need | React Native | Flutter | Notes |
|---|---|---|---|
| Small key-value, non-sensitive | `@react-native-async-storage/async-storage` | `shared_preferences` | settings, flags, drafts; ~strings only |
| Tokens, secrets | `expo-secure-store` / `react-native-keychain` | `flutter_secure_storage` | Keychain/Keystore-backed; ONLY correct home for tokens |
| Relational, queryable | `expo-sqlite`, WatermelonDB | `drift`, `sqflite` | offline-first datasets; WatermelonDB for 10k+ rows with sync |
| Fast sync KV (high frequency) | `react-native-mmkv` | `hive` | 10–30x faster than AsyncStorage; needs native (bare/expo dev-client) |
| Files, images | `expo-file-system` | `path_provider` + dart:io | cache vs documents directory — choose deliberately |

Rules: tokens NEVER in AsyncStorage/SharedPreferences (Rule 2); version your storage keys (`@tasks_v1`) so migrations are possible; wrap every storage read in try/catch — storage can be full, revoked, or corrupt.

### 4.8 Architecture: Feature Folders, Services, MVVM, Offline-First

```
src/
  features/
    auth/        screens/ components/ api.ts hooks.ts store.ts
    tasks/       screens/ components/ api.ts hooks.ts store.ts
  services/      api.ts  storage.ts  push.ts  permissions.ts
  navigation/    index.tsx  types.ts
  theme/         tokens.ts
  lib/           format.ts  validate.ts
```

- Feature folders own everything about one domain; `services/` holds only cross-cutting integrations. NEVER let feature A import feature B's internals — go through exported APIs or a store.
- UI/logic separation: screens compose; hooks hold logic (`useTasks()` returns state + actions); components stay dumb. This is pragmatic MVVM — the hook/view-model is testable without React.
- **Offline-first**: read from cache first, render, then revalidate from network (cache-then-network); mutations go into a **sync queue** (persisted) drained when online; UI applies **optimistic updates** and rolls back on failure. Rule 11 makes this mandatory for core flows.

### 4.9 Lifecycle & Platform Integration

- **AppState**: `foreground | background` (iOS inactive on transitions). Pause timers/video, flush analytics, and refresh tokens on foreground; persist drafts on background — the app can be killed there at any time.
- **Deep links**: custom scheme (`myapp://task/42`) plus universal links (iOS Associated Domains + `apple-app-site-association` JSON on your domain) and App Links (Android intent filters + `assetlinks.json`). Route params MUST go through the same validation as any external input.
- **Push (FCM/APNs)**: flow = create platform credentials in Firebase/Apple portals → request permission in context → get/register device token with your backend on every launch and on refresh → handle three cases: foreground (show local notification yourself, e.g. via notifee), background (system tray), tap (deep link into the payload's screen). 5.6 implements it.
- **Permissions**: request at the moment of need with a rationale screen before the system prompt; on denied, offer a "try again" re-request; on blocked (never ask again), offer `Linking.openSettings()`. Camera/image-picker/location packages: `expo-camera`/`expo-image-picker`/`expo-location`, `image_picker`/`geolocator` on Flutter.

### 4.10 Performance Playbook

- **Lists**: `keyExtractor` stable IDs; `getItemLayout` for fixed row heights; `windowSize={5–9}` to trim render window; `removeClippedSubviews` (Android win, test iOS); `initialNumToRender={10}`; memoize `renderItem` components; NEVER inline heavy arrow bodies.
- **Images**: right-size sources (don't load 2000px into a 40px avatar); use `expo-image` (memory + disk caching, placeholders) or fast-image; blurhash/thumbnails for feeds.
- **JS thread**: avoid anonymous functions/objects in hot paths; `useMemo`/`useCallback` where re-render cost is real (measured, not assumed); Hermes enabled (default in recent RN/Expo — bytecode precompilation cuts startup and memory).
- **Startup**: lazy-load heavy screens (`React.lazy`-equivalents / dynamic imports), defer non-critical SDK init (analytics after first paint), pre-warm only the first screen's data.
- **Measure first**: React DevTools Profiler for re-renders, `perfMonitor`/Flipper for FPS, Flutter DevTools timeline for jank. Fix what the profile names. Rule 8 forbids skipping this.

### 4.11 Flutter Quick Path

- Mental model: everything is a widget; `StatelessWidget` for static, `StatefulWidget` for local mutable state (`setState`); layout = `Column`/`Row` + `Expanded`/`Flexible` for flexible children; scrollables (`ListView.builder`) are the virtualized lists.
- App shell: `MaterialApp` → `Scaffold` (appBar/body/floatingActionButton/bottomNavigationBar); `Navigator 2.0` (Router API) for declarative deep-linkable routing, or plain `Navigator.push` for simple stacks.
- State: `provider` for simple DI/InheritedWidget ergonomics; **Riverpod** (5.7) for typed, testable state — the default recommendation. Dependencies in `pubspec.yaml` under `dependencies:` with pinned versions (`flutter pub add riverpod`).
- Platform: `MediaQuery.of(context).padding` for safe areas; platform-adaptive widgets (`Switch.adaptive()`) when native texture matters.

### 4.12 Testing Pyramid

- **Unit** (many): pure logic, stores, formatters — Jest (`jest.fn()`, `jest.spyOn`) or `vitest`; Flutter: `flutter test`.
- **Component** (some): React Native Testing Library — `render()`, `screen.getByText/getByPlaceholderText/getByRole`, `fireEvent`, `waitFor`; queries from user perspective, not internals (5.5).
- **E2E** (few, happy paths): **Maestro** (YAML flows, runs on real devices/simulators, tolerant of flakiness) or **Detox** (grey-box, faster, stricter). One flow per critical task: signup, core loop, purchase (5.5).
- Contract rule: mock the network at the client boundary in tests; a test suite that needs a live backend is a liability.

### 4.13 Build, Signing & Store Release

**Android**: generate an upload keystore once (`keytool -genkeypair -v -storetype PKCS12 -keystore upload-keystore.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000`); wire it via `key.properties` (never committed) into `build.gradle` `signingConfigs.release`; build an **AAB** (`./gradlew bundleRelease` or EAS); Play listing requires: app icon 512×512 PNG, ≥ 2 phone screenshots, feature graphic 1024×500, **privacy policy URL (mandatory — rejected without it)**, data-safety form, content rating, target API level current per policy. Bump `versionCode` every upload.

**iOS**: enroll Apple Developer ($99/yr); certificates + provisioning profiles (or let EAS/Xcode manage automatically); archive → upload → **TestFlight** (internal testing instant with the team, external needs a beta review); App Store listing: screenshots per device class, description, keywords (100 chars), privacy "nutrition labels" and privacy manifest; review in ~1–3 days. Top rejection reasons: crashes on launch, missing demo account for review, privacy data collection mismatches, metadata/screenshots not matching the app, broken links, incomplete features. Provide a demo account + notes in App Review information.

**Versioning discipline**: `versionName`/`versionCode` and iOS `CFBundleShortVersionString`/`CFBundleVersion` bump every build; automate with `eas build --auto-increment` or a script. NEVER reuse versionCodes — Play rejects them and staged rollout math breaks.

**OTA vs store**: EAS Update (or CodePush-style) pushes JS/asset-only fixes instantly to channels (production/staging); native changes (new modules, permissions, target SDK) require a store release. MUST keep runtime-version policy aligned so OTA never ships incompatible JS to old binaries.

### 4.14 Monitoring, Analytics & QA Matrix

- **Sentry** (`@sentry/react-native`, `Sentry.init({ dsn })`) or **Firebase Crashlytics**: symbolicated stack traces, release tagging, breadcrumbs. Release gate: crash-free sessions ≥ 99.5%.
- **Analytics events**: naming convention `object_action` in snake_case (`task_created`, `checkout_started`); one property schema doc; events are a contract — renaming breaks dashboards.
- **Feature flags**: simple remote-config map checked at startup; default-off for anything risky; flags are how you decouple deploy from release.
- **QA matrix (run every release)**: airplane mode; permission denied/blocked; tiny screen (iPhone SE / 320dp) and huge screen/fold; dark mode; interruption (call, notification) mid-flow; low memory / background-kill and restore; fresh install; upgrade install over the previous store version; offline → online recovery.

## 5. Code & Tool Templates

### 5.1 API client with auth, timeout, retry, and error taxonomy

```js
// src/services/api.js — one client; every failure becomes a typed UI state
import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

export class ApiError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}

export const api = axios.create({
  baseURL: process.env.EXPO_PUBLIC_API_URL ?? 'https://api.example.com/v1',
  timeout: 15000,
});

api.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync('auth_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(null, (error) => {
  const { response, code, message } = error;
  if (code === 'ECONNABORTED' || message === 'Network Error') {
    throw new ApiError('network', 'No connection. Check your network and retry.');
  }
  if (response) {
    if (response.status === 401) throw new ApiError('auth', 'Session expired. Please sign in again.');
    if (response.status >= 500) throw new ApiError('server', 'Server problem. Try again shortly.');
    throw new ApiError('validation', response.data?.message ?? 'That request was invalid.');
  }
  throw new ApiError('unknown', 'Something went wrong.');
});

// Retry ONLY idempotent GETs, with exponential backoff: 500ms, 1s, 2s
export async function getWithRetry(url, tries = 3) {
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      return (await api.get(url)).data;
    } catch (e) {
      if (e.kind !== 'network' || attempt === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 2 ** attempt * 500));
    }
  }
}
```

### 5.2 Auth store: zustand + secure storage (Rule 2 compliant)

```js
// src/features/auth/store.js — token lives ONLY in SecureStore
import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

export const useAuth = create((set) => ({
  status: 'loading',            // 'loading' | 'signedOut' | 'signedIn'
  userId: null,
  async restore() {
    const token = await SecureStore.getItemAsync('auth_token');
    set({ status: token ? 'signedIn' : 'signedOut' });
  },
  async signIn(token, userId) {
    await SecureStore.setItemAsync('auth_token', token);
    set({ status: 'signedIn', userId });
  },
  async signOut() {
    await SecureStore.deleteItemAsync('auth_token');
    set({ status: 'signedOut', userId: null });
  },
}));
```

### 5.3 Navigation skeleton: tabs + stacks

```jsx
// src/navigation/index.jsx — the standard app shape: stacks nested in tabs
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

const Stack = createNativeStackNavigator();
const Tabs = createBottomTabNavigator();

function HomeStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Feed" component={FeedScreen} />
      <Stack.Screen name="Detail" component={DetailScreen} />
    </Stack.Navigator>
  );
}

export default function Root() {
  return (
    <NavigationContainer>
      <Tabs.Navigator screenOptions={{ headerShown: false }}>
        <Tabs.Screen name="Home" component={HomeStack} />
        <Tabs.Screen name="Search" component={SearchScreen} />
        <Tabs.Screen name="Profile" component={ProfileScreen} />
      </Tabs.Navigator>
    </NavigationContainer>
  );
}
// Typed params: type RootStackParamList = { Detail: { id: string } };
// Props: NativeStackScreenProps<RootStackParamList, 'Detail'>
```

### 5.4 Optimized FlatList

```jsx
<FlatList
  data={items}
  keyExtractor={(it) => it.id}                       // stable IDs, never array index
  renderItem={renderRow}                             // memoized row component (React.memo)
  getItemLayout={(_, index) => ({ length: ROW_H, offset: ROW_H * index, index })} // fixed heights only
  windowSize={7}                                     // default 21; 5–9 slashes memory on long feeds
  initialNumToRender={10}
  maxToRenderPerBatch={10}
  removeClippedSubviews                              // Android win; verify on iOS
/>
```

### 5.5 Component test + E2E flow

```jsx
// __tests__/AddBar.test.jsx — React Native Testing Library
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import AddBar from '../src/components/AddBar';

test('adds a task when text is present and Add is pressed', () => {
  const onAdd = jest.fn();
  render(<AddBar onAdd={onAdd} />);
  fireEvent.changeText(screen.getByPlaceholderText('New task…'), 'Buy milk');
  fireEvent.press(screen.getByText('Add'));
  expect(onAdd).toHaveBeenCalledWith('Buy milk');
});

test('ignores empty input', () => {
  const onAdd = jest.fn();
  render(<AddBar onAdd={onAdd} />);
  fireEvent.press(screen.getByText('Add'));
  expect(onAdd).not.toHaveBeenCalled();
});
```

```yaml
# e2e/create_task.yaml — run: maestro test e2e/create_task.yaml
appId: com.example.taskr
---
- launchApp
- tapOn: "New task…"
- inputText: "Buy oat milk"
- tapOn: "Add"
- assertVisible: "Buy oat milk"
```

### 5.6 Push notifications: permission, token, three behaviors

```jsx
// src/services/push.js — FCM/APNs via @react-native-firebase/messaging + notifee
import messaging from '@react-native-firebase/messaging';
import notifee, { AndroidImportance } from '@notifee/react-native';

async function sendTokenToBackend(token) {
  await fetch(`${process.env.EXPO_PUBLIC_API_URL}/devices`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, platform: Platform.OS }),
  });
}

export async function setupPush(onOpen) {
  const auth = await messaging().requestPermission();   // call from a rationale screen tap
  if (auth === messaging.AuthorizationStatus.DENIED) return false;

  const token = await messaging().getToken();
  await sendTokenToBackend(token);                       // register on every launch
  messaging().onTokenRefresh(sendTokenToBackend);        // tokens rotate

  await notifee.createChannel({ id: 'default', name: 'General', importance: AndroidImportance.HIGH });

  messaging().onMessage(async (msg) => {                 // FOREGROUND: you must display it
    await notifee.displayNotification({
      title: msg.notification?.title ?? '', body: msg.notification?.body ?? '',
      android: { channelId: 'default' },
    });
  });
  messaging().onNotificationOpenedApp(onOpen);           // BACKGROUND tap
  const initial = await messaging().getInitialNotification();
  if (initial) onOpen(initial);                          // KILLED-state tap → deep link
  return true;
}
```

### 5.7 Permission gate with rationale + blocked state

```jsx
// src/components/CameraGate.jsx — request in context; handle every state
import { PermissionStatus, useCameraPermissions } from 'expo-camera';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

export function CameraGate({ children }) {
  const [status, request] = useCameraPermissions();
  if (status?.granted) return children;
  if (status == null || status.status === PermissionStatus.UNDETERMINED) {
    return (
      <View style={st.box}>
        <Text style={st.text}>To scan receipts we need the camera. Images stay on your device.</Text>
        <Pressable style={st.btn} onPress={() => request()}>
          <Text style={st.btnText}>Allow camera</Text>
        </Pressable>
      </View>
    );
  }
  return ( // DENIED / BLOCKED: Settings is the only way back
    <View style={st.box}>
      <Text style={st.text}>Camera is off. Enable it in Settings to scan receipts.</Text>
      <Pressable style={st.btn} onPress={() => Linking.openSettings()}>
        <Text style={st.btnText}>Open Settings</Text>
      </Pressable>
    </View>
  );
}
const st = StyleSheet.create({
  box: { padding: 16, gap: 12 },
  text: { fontSize: 16, lineHeight: 22 },
  btn: { minHeight: 48, backgroundColor: '#2563EB', borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  btnText: { color: '#FFFFFF', fontWeight: '600' },
});
```

### 5.8 Complete worked example: TaskR todo app (Expo + Navigation + AsyncStorage)

```jsx
// App.jsx — npm i @react-navigation/native @react-navigation/native-stack react-native-screens
//           react-native-safe-area-context @react-native-async-storage/async-storage
import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const Stack = createNativeStackNavigator();
const KEY = '@tasks_v1';                                   // versioned storage key

function useTasks() {                                      // view-model: logic lives here
  const [tasks, setTasks] = useState(null);                // null = loading state
  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => setTasks(raw ? JSON.parse(raw) : []))
      .catch(() => setTasks([]));
  }, []);
  const persist = (next) => {
    setTasks(next);
    AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
  };
  return {
    tasks,
    add: (title) => persist([{ id: Date.now(), title, done: false }, ...(tasks ?? [])]),
    toggle: (id) => persist((tasks ?? []).map((t) => (t.id === id ? { ...t, done: !t.done } : t))),
    remove: (id) => persist((tasks ?? []).filter((t) => t.id !== id)),
  };
}

function AddBar({ onAdd }) {                               // dumb component: props in, events out
  const [text, setText] = useState('');
  const submit = () => { if (text.trim()) { onAdd(text.trim()); setText(''); } };
  return (
    <View style={s.bar}>
      <TextInput style={s.input} value={text} onChangeText={setText}
        placeholder="New task…" returnKeyType="done" onSubmitEditing={submit} />
      <Pressable style={({ pressed }) => [s.btn, pressed && { opacity: 0.8 }]} onPress={submit}>
        <Text style={s.btnText}>Add</Text>
      </Pressable>
    </View>
  );
}

function ListScreen({ navigation }) {                      // screen: all states handled
  const { tasks, add, toggle, remove } = useTasks();
  if (tasks === null) return <View style={s.center}><ActivityIndicator /></View>;
  return (
    <View style={s.root}>
      <FlatList
        data={tasks}
        keyExtractor={(t) => String(t.id)}
        ListEmptyComponent={<Text style={s.empty}>Nothing yet — add your first task below.</Text>}
        renderItem={({ item }) => (
          <Pressable style={s.row} onPress={() => toggle(item.id)} onLongPress={() => remove(item.id)}
            accessibilityLabel={item.done ? `Completed: ${item.title}` : `Task: ${item.title}`}>
            <Text style={[s.title, item.done && s.done]}>{item.title}</Text>
            <Text style={s.hint}>{item.done ? 'done — long-press to delete' : 'tap to complete'}</Text>
          </Pressable>
        )}
      />
      <AddBar onAdd={add} />
    </View>
  );
}

function AboutScreen() {
  return (
    <View style={s.center}>
      <Text style={s.empty}>TaskR v1.0 — tap to complete, long-press to delete.</Text>
    </View>
  );
}

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="Tasks" component={ListScreen} options={{ title: 'My Tasks' }} />
        <Stack.Screen name="About" component={AboutScreen} options={{ title: 'About' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  row: { padding: 16, minHeight: 48, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB' },
  title: { fontSize: 16, lineHeight: 22, color: '#111827' },
  done: { textDecorationLine: 'line-through', color: '#9CA3AF' },
  hint: { fontSize: 12, color: '#9CA3AF', marginTop: 4 },
  empty: { textAlign: 'center', color: '#6B7280', fontSize: 16 },
  bar: { flexDirection: 'row', padding: 12, gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E5E7EB' },
  input: { flex: 1, minHeight: 44, borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, paddingHorizontal: 12 },
  btn: { minHeight: 44, backgroundColor: '#2563EB', borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  btnText: { color: '#FFFFFF', fontWeight: '600' },
});
```

```dart
// Flutter counterpart: minimal Riverpod counter (pub add flutter_riverpod)
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

final counterProvider = StateProvider<int>((ref) => 0);

void main() => runApp(const ProviderScope(child: App()));

class App extends StatelessWidget {
  const App({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
        home: Scaffold(
          appBar: AppBar(title: const Text('Counter')),
          body: Center(
            child: Consumer(builder: (context, ref, _) {
              final count = ref.watch(counterProvider);
              return Text('Taps: $count',
                  style: Theme.of(context).textTheme.headlineMedium);
            }),
          ),
          floatingActionButton: FloatingActionButton(
            onPressed: () => ref.read(counterProvider.notifier).state++,
            child: const Icon(Icons.add),
          ),
        ),
      );
}
```

## 6. Decision Tables

**Framework selection**

| Factor | React Native (+Expo) | Flutter | Native Swift/Kotlin |
|---|---|---|---|
| Team already knows | JS/TS | Dart | Swift/Kotlin |
| UI consistency across platforms | Native texture per platform | Identical brand UI everywhere | Perfectly platform-native |
| Raw performance ceiling | High (New Arch) | High (Impeller) | Highest |
| Native-deep features (widgets, watch) | Via modules; some lag | Via platform channels | First-class, day one |
| OTA JS updates | Yes (EAS Update) | Limited (Shorebird) | No |
| Timeline for CRUD app | Fastest | Fast | Slowest (two codebases) |
| Pick when | JS team, app-like CRUD, OTA needed | Brand UI matters, Dart team, custom canvas-like UI | Platform-deep features, top perf, long-lived flagship |

**Storage selection**: settings/flags → AsyncStorage/shared_preferences; tokens/secrets → SecureStore/Keychain/Keystore ONLY; queryable offline data → SQLite (expo-sqlite/drift/WatermelonDB for sync); high-frequency KV → MMKV/Hive; files → FileSystem with explicit cache-vs-documents choice.

**State management**: component-local → `useState`/`useReducer`; low-frequency global (auth/theme) → Context or zustand; frequent global updates → zustand with narrow selectors; server cache → TanStack Query; large-team conventions → Redux Toolkit; Flutter → Riverpod.

**Release channel**: JS-only bugfix → OTA (EAS Update) same-day; new native module or permission → store release; risky feature → store release behind a feature flag; first external test → TestFlight/Play internal track, never production.

## 7. Quality Checklist

Verify EVERY item before calling any build "release candidate":

- [ ] Stack rationale written and native-only requirements confirmed absent
- [ ] No secrets in the repo; environment config per build channel
- [ ] Tokens/secrets only in SecureStore/Keychain/Keystore — grep AsyncStorage for keys to prove it
- [ ] Every API call has timeout + typed error handling; all four error classes render UI states
- [ ] Server-side validation assumed and enforced for all client input
- [ ] Every screen implements loading, empty, error, and content states
- [ ] Long lists use FlatList/ListView.builder with tuned props, not `.map()` in ScrollView
- [ ] Permissions requested in context with rationale; denied and blocked states handled
- [ ] Push: token registered on launch + refresh; foreground/background/tap behaviors verified
- [ ] Deep links validated like external input; unlinked (cold-start) route tested
- [ ] Core flow works offline (cache-then-network or queue) — airplane-mode tested
- [ ] Crash reporting wired and events arriving (test-crash verified)
- [ ] Unit + component tests pass; one Maestro/Detox happy path per critical task green
- [ ] QA matrix executed: airplane, denied permissions, tiny/huge screens, dark, interruption, fresh + upgrade install
- [ ] App runs at 200% font scale without truncation; dark mode tokens verified
- [ ] versionCode/build number bumped; previous number never reused
- [ ] Android: keystore backed up; AAB built; privacy policy URL live; listing assets complete
- [ ] iOS: demo account + review notes filled; privacy labels match actual collection
- [ ] Crash-free sessions ≥ 99.5% on the internal build before staged rollout
- [ ] OTA channel + runtime version policy verified so JS updates match binaries

## 8. Common Mistakes & Fixes

1. **Mistake: tokens in AsyncStorage.** Symptom: security review fails; tokens leak via backups. Fix: SecureStore/Keychain only; migrate and delete old keys.
2. **Mistake: `.map()` of 500 rows inside ScrollView.** Symptom: freezing, 1GB+ memory, OOM crashes on old devices. Fix: FlatList with the 5.4 props.
3. **Mistake: no error states — spinners or blank screens on failure.** Symptom: "app broken" reviews during your API outage. Fix: 5.1 taxonomy; every screen renders all four states.
4. **Mistake: permission prompt at cold launch.** Symptom: most users tap "Don't allow" forever. Fix: rationale screen → request at the moment of need; handle blocked with openSettings.
5. **Mistake: forgetting server-side validation.** Symptom: garbage or malicious data from modified clients. Fix: validate at the API boundary; client checks are UX only.
6. **Mistake: same versionCode twice.** Symptom: Play upload rejected; staged rollout stuck. Fix: auto-increment on every build; never hand-edit downwards.
7. **Mistake: optimizing before profiling.** Symptom: days spent memoizing the wrong component; jank persists. Fix: profiler first (Rule 8); fix the measured hotspot.
8. **Mistake: array index as keyExtractor.** Symptom: rows flicker/mis-animate on reorder/delete. Fix: stable entity IDs.
9. **Mistake: missing privacy policy / data-safety mismatch.** Symptom: Play listing rejected or suspended. Fix: publish policy URL; make store data forms match SDK behavior exactly.
10. **Mistake: no demo account for App Review.** Symptom: "we couldn't sign in" rejection, +2 days lost. Fix: review-notes demo credentials tested on a fresh device.
11. **Mistake: inline styles and anonymous functions everywhere in a hot list.** Symptom: scroll jank on Android. Fix: StyleSheet.create + memoized rows; measure with the profiler.
12. **Mistake: shipping OTA that requires a native change.** Symptom: EAS Update deploys, app still crashes — new module was native-only. Fix: classify every change native-vs-JS before choosing the channel; native change = store release.

## 9. Advanced Techniques

- **OTA strategy with EAS Update**: channels (production/staging) + `runtimeVersion` policy (`appVersion` or `fingerprint`); publish JS fixes to staging, verify on a real device, then promote to production with `eas update --republish` to roll back instantly. Treat OTA as hotfix tooling — never ship features first via OTA to dodge review.
- **Offline-first sync queue**: persist mutations `{id, payload, attempts}` in SQLite; drain FIFO when connectivity returns; idempotency keys server-side; optimistic UI with rollback. WatermelonDB gives you this scaffolding for large datasets.
- **Native escape hatch**: when no module exists, write a TurboModule (RN) or MethodChannel (Flutter): declare the JS/Dart interface, implement in Swift/Kotlin, register, and unit-test the bridge contract. Keep bridges thin and dumb — logic stays in the JS/Dart layer.
- **App size diet**: Hermes on; ABI splits / app bundles per-device delivery; shrink image assets (WebP/SVG); remove dead JS via dependency audit; monitor with the AAB analyzer / Xcode thinning report. Every 10MB matters for emerging-market conversion.
- **Deep-link routing table**: keep one mapping file (path → screen → params → guards) as the single source for both `linking` config and push navigation; guards (auth required?) evaluated centrally so a notification can never deep-link into an unauthenticated screen.
- **CI/CD pipeline**: PR → lint + typecheck + unit/component tests; merge → EAS Build to internal channel + Maestro smoke on simulator; tag → store build with auto-increment + release notes from conventional commits. Humans review, pipelines build.

## 10. Quick Reference Card

- Timeout **15s**; retry GET only, backoff **500ms → 1s → 2s**; four error kinds: network/auth/server/validation.
- Tokens: **SecureStore/Keychain/Keystore only**. Settings: AsyncStorage. Queryable: SQLite. Fast KV: MMKV.
- Tabs: **3–5**; stacks inside tabs; typed params; pass IDs, not objects.
- FlatList: `keyExtractor` stable ID · `getItemLayout` fixed rows · `windowSize` 5–9 · `initialNumToRender` 10 · memoized rows.
- Permissions: rationale → request in context → handle denied + blocked (openSettings).
- Push: register token on launch + refresh; foreground = display yourself; tap = deep link.
- Every screen: **loading / empty / error / content** — four states, non-negotiable.
- Release: bump version every upload · AAB + privacy policy (Play) · demo account (App Review) · staged rollout · crash-free ≥ 99.5%.
- Tests: unit many, component some, E2E one happy path per critical task (Maestro YAML).
- OTA for JS fixes only; native change = store release.
- Profile before optimizing; Hermes on; lazy-load heavy screens.
- QA matrix: airplane · denied · tiny/huge · dark · interruption · fresh + upgrade install.

