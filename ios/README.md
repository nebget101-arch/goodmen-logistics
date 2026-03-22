# FleetNeuron Driver – iOS (Swift/SwiftUI)

Driver app for **iPhone and iPad**: sign in, view **My Loads**, and upload documents (Proof of Delivery, BOL, Lumper receipt, Roadside maintenance receipt).

## Requirements

- **Xcode 15+** (Swift 5.9+, iOS 17+ for `PhotosPicker`; can lower to iOS 16 by using `PhotosPickerItem` only)
- **FleetNeuron API** running (gateway + logistics + auth-users services; driver role and loads APIs)

## Create the project in Xcode

1. **New project**
   - File → New → Project
   - **App** (iOS)
   - Product Name: **FleetNeuron Driver**
   - Team: your team
   - Organization Identifier: e.g. `com.fleetneuron`
   - Interface: **SwiftUI**
   - Language: **Swift**
   - Uncheck “Include Tests” if you want to add them later.
   - Save inside this repo (e.g. `FleetNeuronAPP/ios/`) or outside; then add the source files.

2. **Add the app source**
   - In the Project Navigator, **delete** the default `ContentView.swift` and `FleetNeuronDriverApp.swift` that Xcode created (if any).
   - **Add** the contents of the `FleetNeuronDriver` folder (including the **Theme** folder with `AppTheme.swift`):
     - **Add Files to "FleetNeuron Driver"...** → select the `FleetNeuronDriver` folder.
     - Ensure **Copy items if needed** is unchecked if the folder is already under the repo.
     - Ensure your app target is checked for all added files.

3. **Target settings**
   - Select the **FleetNeuron Driver** target → **General**:
     - **Deployment Info**: set **iPhone** and **iPad** (Universal).
     - **Minimum Deployments**: iOS **16.0** or **17.0** (17.0 if you use the current `PhotosPicker` API as-is).
   - **Info** tab (or `Info.plist`):
     - Add **Privacy - Photo Library Usage Description**:  
       `FleetNeuron Driver needs access to your photo library to upload proof of delivery, BOL, lumper, and roadside receipts.`
     - Add **Privacy - Camera Usage Description** (optional):  
       `FleetNeuron Driver can use the camera to capture documents for your loads.`
   - **Build Settings** → search “Info.plist”:
     - Set **Info.plist File** to `FleetNeuronDriver/Info.plist` (relative to the project).

4. **API base URL**
   - Either set **API_BASE_URL** in the app’s scheme:
     - Product → Scheme → Edit Scheme → **Run** → **Arguments** → **Environment Variables** → add `API_BASE_URL` = `http://localhost:4000` (or your gateway URL).
   - Or in **Info.plist** add a key `API_BASE_URL` (String) with value e.g. `https://your-gateway.onrender.com` (no trailing slash).
   - For **simulator** pointing at your Mac: use `http://localhost:4000` or `http://127.0.0.1:4000`.
   - For **device** on same Wi‑Fi: use your Mac’s LAN IP, e.g. `http://192.168.1.10:4000`.

5. **Web base URL (forgot password, FN-165)**  
   - **Info.plist** key **`WEB_BASE_URL`**: public FleetNeuron web origin with **no trailing slash** (default `https://fleetneuron.ai`).  
   - The login screen opens **`{WEB_BASE_URL}/forgot-password`** in an in-app Safari view. Override for staging (e.g. `https://your-preview.example.com`) or local Angular (`http://localhost:4200`).  
   - You can also set the **`WEB_BASE_URL`** environment variable in the Run scheme instead of Info.plist.

6. **Multi-entity / MC context (FN-166)**  
   - The driver app shows the **operating entity / carrier** returned for the signed-in driver (see profile screen).  
   - **Switching** between multiple carriers for one user is **not** implemented in the native app: tenant and operating-entity scope are determined server-side from the account. Users who need a different default carrier should use the **web** FleetNeuron app or an administrator. Future APIs could add an explicit switcher; until then the app stays **single carrier context per session**.

## Run on iPhone / iPad

- Choose **My Mac (Designed for iPad)** or a connected **iPhone/iPad**.
- Build and run (⌘R).
- Log in with a **driver** user (role `driver`, linked to a driver via `driverId`). The app will list only that driver’s loads and allow document uploads.

## Layout (iPhone vs iPad)

- **iPhone**: list → tap load → detail with documents; **+** opens upload sheet.
- **iPad**: **NavigationSplitView** — list on the left, load detail on the right; **+** opens upload sheet. Same codebase, adaptive.

## API endpoints used

- `POST /api/auth/login` – sign in
- `GET /api/users/me` – current user (driver_id for driver role)
- `GET /api/loads?driverId=...` – list loads (backend scopes by driver when role is driver)
- `GET /api/loads/:id` – load detail
- `GET /api/loads/:id/attachments` – list documents
- `POST /api/loads/:id/attachments` – upload (multipart: file + type + notes)

Document types: `PROOF_OF_DELIVERY`, `BOL`, `LUMPER`, `ROADSIDE_MAINTENANCE_RECEIPT`, `OTHER`.
