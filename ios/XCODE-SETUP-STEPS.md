# Step-by-step: Set up FleetNeuron Driver in Xcode (beginner-friendly)

Follow these steps in order. You’ll end up with the FleetNeuron Driver app running on the iPhone or iPad simulator (or a real device).

---

## Step 1: Install Xcode (if you don’t have it)

1. Open the **App Store** on your Mac.
2. Search for **Xcode**.
3. Click **Get** / **Install** and wait for it to finish (Xcode is large).
4. Open **Xcode** once. If it asks to install “additional components,” click **Install**.
5. If it asks for **Command Line Tools**, choose **Install**.

---

## Step 2: Open Xcode and create a new app project

1. Open **Xcode**.
2. In the welcome window, click **Create New Project**  
   (or use menu **File → New → Project**).
3. In the template chooser:
   - At the top, select the **iOS** tab.
   - Under “Application,” select **App**.
   - Click **Next**.
4. Fill in the project options:
   - **Product Name:** `FleetNeuron Driver`
   - **Team:** Choose your Apple ID team (or “Add an Account…” and sign in with your Apple ID).
   - **Organization Identifier:** e.g. `com.fleetneuron` or `com.yourname`
   - **Bundle Identifier:** Leave as-is (it will be something like `com.fleetneuron.FleetNeuron-Driver`).
   - **Interface:** **SwiftUI**
   - **Language:** **Swift**
   - **Storage:** leave unchecked.
   - **Include Tests:** optional (you can uncheck to keep it simple).
5. Click **Next**.
6. Choose **where to save** the project:
   - **Important:** Save it **inside** your FleetNeuron folder, e.g.  
     `Desktop/FleetNeuronAPP/ios/`  
     so the new project sits next to the existing `FleetNeuronDriver` folder with the app code.
   - Or save anywhere you like; you’ll point Xcode at the `FleetNeuronDriver` folder in the next step.
7. Click **Create**. Xcode will create a new project and show the project editor.

---

## Step 3: Remove the default files Xcode created

Xcode added its own `ContentView` and app file. We’ll use the ones from the `FleetNeuronDriver` folder instead.

1. In the **left sidebar** (Project Navigator), find the **FleetNeuron Driver** group (the yellow folder icon).
2. Under it you’ll see something like:
   - `FleetNeuron_DriverApp.swift`
   - `ContentView.swift`
   - `Assets.xcassets`
3. **Right‑click** `FleetNeuron_DriverApp.swift` (or the name with your app name) → **Delete**.
4. Choose **Move to Trash** (not “Remove Reference”).
5. Do the same for **ContentView.swift** (right‑click → Delete → Move to Trash).

Keep **Assets.xcassets**; we’ll keep the default app icon for now.

---

## Step 4: Add the FleetNeuron Driver source code

You need to add the **FleetNeuronDriver** folder (the one that contains `FleetNeuronDriverApp.swift`, `ContentView.swift`, `Models`, `Services`, `Views`, etc.).

1. In the **menu bar**, click **File → Add Files to "FleetNeuron Driver"...**
2. In the file picker, **go to the folder** that contains the app code:
   - If you saved the project in `FleetNeuronAPP/ios/`, go to that `ios` folder.
   - You should see a folder named **FleetNeuronDriver** (with the Swift files inside).
3. **Select the FleetNeuronDriver folder** (one click on the folder).
4. At the bottom of the dialog, set:
   - **Copy items if needed:** **unchecked** (so we use the files in place).
   - **Added folders:** **Create groups**.
   - **Add to targets:** **FleetNeuron Driver** must be **checked**.
5. Click **Add**.
6. In the left sidebar you should now see a **FleetNeuronDriver** group with:
   - `FleetNeuronDriverApp.swift`
   - `ContentView.swift`
   - `Models` (with AuthResponse, Load)
   - `Services` (APIClient, AuthManager)
   - `Views` (Login, LoadListView, LoadDetailView, DocumentUploadView)
   - `Info.plist` (if you added the folder that contains it)

If **Info.plist** is not there:

- In the Project Navigator, find **Info.plist** under the **FleetNeuronDriver** group.
- If it’s missing, we’ll set the required keys in the target’s Info tab in Step 6.

---

## Step 5: Set the app’s main file and target membership

1. Click the **blue project icon** at the very top of the left sidebar (the one named “FleetNeuron Driver” or similar).
2. Under **TARGETS**, select **FleetNeuron Driver**.
3. Open the **General** tab.
4. Under **App Icons and Launch Screen**:
   - **Main Interface:** leave blank (SwiftUI apps don’t need it).
5. Scroll to **Deployment Info**:
   - **iPhone** and **iPad** should both be **checked** (so the app runs on both).
   - **Minimum Deployments:** set to **iOS 16.0** or **17.0** (17.0 is safest with the current code).
6. Under **Main Interface**, if there’s a dropdown, leave it empty or set to the main SwiftUI scene.

Make sure the target’s **Build Phases → Compile Sources** includes all the `.swift` files from the FleetNeuronDriver group. If any are missing, select them in the Project Navigator and in the right panel under **Target Membership** check **FleetNeuron Driver**.

---

## Step 6: Point the app to the Info.plist and add privacy / API URL

1. Still in the project settings, with the **FleetNeuron Driver** target selected, open the **Build Settings** tab.
2. In the search box, type **Info.plist**.
3. Find **Info.plist File**.
4. Set the value to the path to the plist **inside** the FleetNeuronDriver folder, e.g.:  
   `FleetNeuronDriver/Info.plist`  
   (relative to the project folder). If your structure is different, use the path that matches where `Info.plist` lives.

If you **don’t** have an Info.plist in the project:

1. Select the **FleetNeuron Driver** target → **Info** tab.
2. Add these rows (click the **+** next to an existing row):
   - **Privacy - Photo Library Usage Description**  
     Value: `FleetNeuron Driver needs access to your photo library to upload proof of delivery, BOL, lumper, and roadside receipts.`
   - **Privacy - Camera Usage Description** (optional)  
     Value: `FleetNeuron Driver can use the camera to capture documents for your loads.`
3. Add the API URL so the app knows where your backend is:
   - **Add** a new row.
   - Key: `API_BASE_URL` (you may need to choose “Add row” and type the key manually).
   - Type: **String**.
   - Value:  
     - For **Simulator** talking to your Mac: `http://localhost:4000`  
     - For **real device** on same Wi‑Fi: `http://YOUR_MAC_IP:4000` (e.g. `http://192.168.1.10:4000`).  
     No trailing slash.

---

## Step 7: Set the API URL in the run scheme (recommended)

So the app always uses the right backend when you run it:

1. In the **menu bar**, click **Product → Scheme → Edit Scheme...** (or press **⌘<**).
2. On the left, select **Run**.
3. Open the **Arguments** tab.
4. Under **Environment Variables**, click the **+**.
5. Name: `API_BASE_URL`  
   Value: `http://localhost:4000` (or your gateway URL; no trailing slash).
6. Click **Close**.

---

## Step 8: Build the project

1. At the top left of Xcode, use the **scheme** dropdown: choose the scheme that builds **this app** (e.g. **FleetNeuron** or **FleetNeuron Driver**) and a **destination** (e.g. **iPhone 15** or **iPad Pro 13-inch**). If you have multiple targets, pick the one that includes `LoadListView`, `LoadDetailView`, and `FleetNeuronDriverApp`.
2. Press **⌘B** (or **Product → Build**).
3. Fix any errors that appear:
   - If it says a file is missing, check **Step 4** and that all FleetNeuronDriver files are added and have **Target Membership → FleetNeuron Driver** checked.
   - If it complains about iOS version, set **Minimum Deployments** in **Step 5** to **iOS 17.0**.

---

## Step 9: Run the app in the simulator

1. Leave the destination as **iPhone 15** (or any iPhone/iPad simulator).
2. Press **⌘R** (or click the **Run** button).
3. The simulator will start and launch the app. You should see the **FleetNeuron Driver** login screen.
4. Make sure your **FleetNeuron API is running** (gateway, auth, logistics) and that you have a **driver** user (role `driver` with `driverId` set). Then log in with that user to see “My Loads” and test uploads.

---

## Step 10: Run on a real iPhone or iPad (optional)

1. Connect your device with a USB cable.
2. On the device: **Settings → General → VPN & Device Management** (or **Profiles**) and trust your developer account if asked.
3. In Xcode, use the **destination** dropdown and select your **device** (e.g. “Nebyu’s iPhone”).
4. Press **⌘R**.
5. If Xcode says the app is “untrusted,” on the device go to **Settings → General → VPN & Device Management**, select your developer account, and tap **Trust**.
6. Set **API_BASE_URL** (in the scheme or Info.plist) to your Mac’s IP (e.g. `http://192.168.1.10:4000`) so the device can reach the API on your network.

---

## Keeping Xcode and the codebase in sync

The **source of truth** for the app code is this folder in the repo:

- **`FleetNeuronAPP/ios/FleetNeuronDriver/`**  
  (all Swift files, Info.plist, Models, Services, Views)

If your Xcode project lives somewhere else (e.g. **FleetNeuron Drive** on your Desktop or inside the repo), Xcode and Cursor will stay in sync only if Xcode is using **that same folder**—not a copy.

**To sync Xcode with the codebase:**

1. In Xcode, click the **blue project icon** at the top of the left sidebar.
2. In the **Project Navigator**, see which files/groups are under your app target. If you see a **FleetNeuronDriver** (or similar) group that points to a **different** path than `FleetNeuronAPP/ios/FleetNeuronDriver/`, that’s why they’re out of sync.
3. **Remove the old reference:** Right‑click the group that has the app code (e.g. FleetNeuronDriver) → **Delete** → choose **Remove Reference** (so we don’t delete the files on disk).
4. **Add the repo folder:** **File → Add Files to "FleetNeuron Driver"...** (or your project name). In the file picker, go to **FleetNeuronAPP/ios/** and select the **FleetNeuronDriver** folder.
5. At the bottom of the dialog:
   - **Copy items if needed:** **unchecked** (so Xcode uses the files in place).
   - **Added folders:** **Create groups**.
   - **Add to targets:** check **FleetNeuron Driver** (or your app target).
6. Click **Add**.
7. In **Build Settings**, set **Info.plist File** to the path to the plist inside that folder (e.g. `FleetNeuronDriver/Info.plist` or `ios/FleetNeuronDriver/Info.plist` depending on where the project file lives).
8. **Build** (⌘B) to confirm everything compiles.

From then on, edits in Cursor to `ios/FleetNeuronDriver/` are the same files Xcode builds; no need to copy or update anything else in Xcode.

---

## Quick checklist

- [ ] Xcode installed and opened at least once  
- [ ] New iOS App project created (SwiftUI, Swift)  
- [ ] Default app/ContentView files removed  
- [ ] FleetNeuronDriver folder added to the project (Create groups, target checked)  
- [ ] Target: iPhone + iPad, minimum iOS 16 or 17  
- [ ] Info.plist path set in Build Settings (or keys added in Info tab)  
- [ ] Privacy - Photo Library Usage Description added  
- [ ] API_BASE_URL set (scheme or Info.plist) to `http://localhost:4000` or your gateway  
- [ ] Build succeeds (⌘B)  
- [ ] App runs in simulator (⌘R) and shows login  
- [ ] Backend running and driver user exists for testing  

---

## If something goes wrong

- **“No such module” or missing files:** Ensure every `.swift` file under FleetNeuronDriver is in **Build Phases → Compile Sources** and has the FleetNeuron Driver target checked in the File Inspector (right panel).
- **App crashes on launch:** Check that **FleetNeuronDriverApp.swift** is the file with `@main` and that you didn’t leave a second `@main` in another file.
- **“Cannot connect to server” / login fails:** Confirm the API is running and **API_BASE_URL** is correct. For simulator use `http://localhost:4000`; for device use your Mac’s IP and ensure the device and Mac are on the same Wi‑Fi.
- **Photos or upload don’t work:** Ensure **Privacy - Photo Library Usage Description** is set; the first time you tap “Choose photo” the system will show the permission alert.

Once this is done, you’re set: you can develop and run the FleetNeuron Driver app on both iPhone and iPad from Xcode.
