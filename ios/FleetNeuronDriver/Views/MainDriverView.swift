//
//  MainDriverView.swift
//  FleetNeuron Driver – ezLoads-style: tabs + side drawer
//

import SwiftUI
import MapKit

@available(iOS 16.0, *)
struct MainDriverView: View {
    @EnvironmentObject var auth: AuthManager
    @State private var selectedTab = 0
    @State private var showDrawer = false
    @State private var showProfile = false
    @State private var loads: [LoadListItem] = []
    @State private var loading = false

    var body: some View {
        ZStack(alignment: .leading) {
            VStack(spacing: 0) {
                topBar
                TabView(selection: $selectedTab) {
                    HomeTabView(loads: loads, loading: loading)
                        .tag(0)
                    LoadListViewEmbed()
                        .tag(1)
                    DocumentsTabView()
                        .tag(2)
                    ScanTabView()
                        .tag(3)
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                .onChange(of: selectedTab) { _ in }
                bottomTabBar
            }
            .background(AppTheme.background)

            if showDrawer {
                Color.black.opacity(0.4)
                    .ignoresSafeArea()
                    .onTapGesture { withAnimation(.easeOut(duration: 0.2)) { showDrawer = false } }
            }

            sideDrawer
        }
        .task { await fetchLoads() }
        .sheet(isPresented: $showProfile) {
            NavigationStack {
                DriverProfileView()
                    .environmentObject(auth)
            }
        }
    }

    private var topBar: some View {
        HStack {
            Button {
                withAnimation(.easeOut(duration: 0.2)) { showDrawer = true }
            } label: {
                Image(systemName: "line.3.horizontal")
                    .font(.system(size: 20))
                    .foregroundStyle(AppTheme.successGreen)
                    .frame(width: 44, height: 44)
            }
            Spacer()
            Text("FleetNeuron")
                .font(.headline)
                .foregroundStyle(AppTheme.textPrimary)
            Spacer()
            Button {
                auth.logout()
            } label: {
                Label("Log Out", systemImage: "rectangle.portrait.and.arrow.right")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(AppTheme.danger)
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 8)
        .background(AppTheme.cardBackground)
        .overlay(
            Rectangle()
                .frame(height: 1)
                .foregroundStyle(AppTheme.borderColor),
            alignment: .bottom
        )
    }

    private var sideDrawer: some View {
        HStack {
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Button {
                        withAnimation(.easeOut(duration: 0.2)) { showDrawer = false }
                    } label: {
                        Image(systemName: "line.3.horizontal")
                            .font(.system(size: 20))
                            .foregroundStyle(AppTheme.textSecondary)
                    }
                    Spacer()
                    Text("FleetNeuron")
                        .font(.headline)
                        .foregroundStyle(AppTheme.textPrimary)
                    Spacer()
                    Color.clear.frame(width: 44, height: 44)
                }
                .padding(16)

                VStack(alignment: .leading, spacing: 16) {
                    HStack(spacing: 12) {
                        Circle()
                            .fill(AppTheme.successGreen.opacity(0.3))
                            .frame(width: 56, height: 56)
                            .overlay(
                                Image(systemName: "person.fill")
                                    .foregroundStyle(AppTheme.successGreen)
                                    .font(.title2)
                            )
                        VStack(alignment: .leading, spacing: 2) {
                            Text(auth.username ?? "Driver")
                                .font(.headline)
                                .foregroundStyle(AppTheme.textPrimary)
                            Text("FleetNeuron Driver")
                                .font(.caption)
                                .foregroundStyle(AppTheme.successGreen)
                        }
                    }
                    .padding(.bottom, 8)

                    drawerLink(icon: "truck.box.fill", title: "My Loads") {
                        selectedTab = 1
                        showDrawer = false
                    }
                    drawerLink(icon: "doc.fill", title: "Documents") {
                        selectedTab = 2
                        showDrawer = false
                    }
                    drawerLink(icon: "person.fill", title: "My Profile") {
                        showProfile = true
                        showDrawer = false
                    }
                    Spacer()
                    Button {
                        auth.logout()
                        showDrawer = false
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: "rectangle.portrait.and.arrow.right")
                                .font(.title3)
                            Text("Log Out")
                                .font(.headline)
                        }
                        .foregroundStyle(AppTheme.danger)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(AppTheme.danger.opacity(0.15))
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                    .padding(.top, 16)
                }
                .padding(.horizontal, 16)
                Spacer()
            }
            .frame(width: 280)
            .background(AppTheme.cardBackground)
            .overlay(
                Rectangle()
                    .frame(width: 1)
                    .foregroundStyle(AppTheme.borderColor),
                alignment: .trailing
            )
            .offset(x: showDrawer ? 0 : -300)
            .animation(.easeOut(duration: 0.2), value: showDrawer)

            Spacer()
        }
    }

    private func drawerLink(icon: String, title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .foregroundStyle(AppTheme.textSecondary)
                    .frame(width: 24, alignment: .center)
                Text(title)
                    .foregroundStyle(AppTheme.textPrimary)
                Spacer()
            }
            .padding(.vertical, 12)
        }
    }

    private var bottomTabBar: some View {
        HStack(spacing: 0) {
            tabItem(icon: "house.fill", title: "Home", tag: 0)
            tabItem(icon: "truck.box.fill", title: "My Loads", tag: 1)
            tabItem(icon: "doc.fill", title: "Documents", tag: 2)
            tabItem(icon: "viewfinder", title: "Scan", tag: 3)
        }
        .padding(.top, 12)
        .padding(.bottom, 24)
        .background(AppTheme.cardBackground)
        .overlay(
            Rectangle()
                .frame(height: 1)
                .foregroundStyle(AppTheme.borderColor),
            alignment: .top
        )
    }

    private func tabItem(icon: String, title: String, tag: Int) -> some View {
        Button {
            selectedTab = tag
        } label: {
            VStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 22))
                Text(title)
                    .font(.caption2)
            }
            .frame(maxWidth: .infinity)
            .foregroundStyle(selectedTab == tag ? AppTheme.successGreen : AppTheme.textSecondary)
        }
        .buttonStyle(.plain)
    }

    private func fetchLoads() async {
        guard let token = auth.token else { return }
        await MainActor.run { loading = true }
        defer { Task { @MainActor in loading = false } }
        do {
            let res = try await APIClient.shared.loadList(token: token, driverId: auth.driverId)
            let allLoads = res.data ?? []
            // Exclude delivered loads – show only assigned (new/in-progress) loads
            let active = allLoads.filter { ($0.status ?? "").uppercased() != "DELIVERED" }
            await MainActor.run { loads = active }
        } catch {
            await MainActor.run { loads = [] }
        }
    }
}

// MARK: - Home Tab (map with driver location + assigned load cards)
@available(iOS 16.0, *)
struct HomeTabView: View {
    let loads: [LoadListItem]
    let loading: Bool
    @ObservedObject private var locationManager = LocationManager.shared
    @State private var mapRegion = MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: 32.95, longitude: -96.82),
        span: MKCoordinateSpan(latitudeDelta: 0.05, longitudeDelta: 0.05)
    )

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                mapSection
                ForEach(loads.prefix(5)) { load in
                    loadCard(load)
                }
                if loads.isEmpty && !loading {
                    Text("No new loads assigned")
                        .foregroundStyle(AppTheme.textSecondary)
                        .frame(maxWidth: .infinity)
                        .padding(40)
                }
            }
        }
        .background(AppTheme.background)
        .onAppear {
            locationManager.requestWhenInUseAuthorization()
            locationManager.startUpdatingLocation()
        }
        .onChange(of: locationManager.location?.coordinate.latitude) { _ in
            if let c = locationManager.coordinate {
                mapRegion = MKCoordinateRegion(
                    center: c,
                    span: MKCoordinateSpan(latitudeDelta: 0.05, longitudeDelta: 0.05)
                )
            }
        }
    }

    private var mapSection: some View {
        Map(coordinateRegion: $mapRegion, showsUserLocation: true)
            .frame(height: 220)
            .allowsHitTesting(false)
            .onAppear {
                if let coord = locationManager.coordinate {
                    mapRegion = MKCoordinateRegion(
                        center: coord,
                        span: MKCoordinateSpan(latitudeDelta: 0.05, longitudeDelta: 0.05)
                    )
                }
            }
    }

    private func loadCard(_ load: LoadListItem) -> some View {
        NavigationLink {
            LoadDetailView(loadId: load.id, onDismiss: {})
        } label: {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("LOAD# \(load.load_number ?? "—")")
                        .font(.headline)
                        .foregroundStyle(AppTheme.textPrimary)
                    Spacer()
                    if let pd = load.pickup_date, !pd.isEmpty {
                        Text(formatDate(pd))
                            .font(.subheadline)
                            .foregroundStyle(AppTheme.textSecondary)
                    }
                }
                if let pick = load.pickup_city, let ps = load.pickup_state,
                   let del = load.delivery_city, let ds = load.delivery_state {
                    Text("\(pick), \(ps) → \(del), \(ds)")
                        .font(.subheadline)
                        .foregroundStyle(AppTheme.textPrimary)
                        .lineLimit(1)
                }
                HStack {
                    Spacer()
                    Text("VIEW")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                        .background(AppTheme.danger)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity)
            .background(AppTheme.cardBackground)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(AppTheme.borderColor, lineWidth: 1)
            )
            .cornerRadius(12)
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 16)
        .padding(.top, 12)
    }

    private func formatDate(_ s: String) -> String {
        let df = ISO8601DateFormatter()
        df.formatOptions = [.withFractionalSeconds, .withInternetDateTime]
        guard let d = df.date(from: s) ?? ISO8601DateFormatter().date(from: s) else { return s }
        let out = DateFormatter()
        out.dateStyle = .short
        return out.string(from: d)
    }
}

// MARK: - Load List Embed (used inside tab)
@available(iOS 16.0, *)
struct LoadListViewEmbed: View {
    var body: some View {
        LoadListView()
            .navigationBarHidden(true)
    }
}

// MARK: - Documents Tab
@available(iOS 16.0, *)
struct DocumentsTabView: View {
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    Text("Documents")
                        .font(.title2)
                        .foregroundStyle(AppTheme.textPrimary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Text("View and manage your uploaded documents from load details.")
                        .font(.subheadline)
                        .foregroundStyle(AppTheme.textSecondary)
                        .multilineTextAlignment(.center)
                        .padding(.vertical, 40)
                }
                .padding(16)
            }
            .background(AppTheme.background)
            .navigationTitle("Documents")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

// MARK: - Scan Tab
@available(iOS 16.0, *)
struct ScanTabView: View {
    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                Image(systemName: "viewfinder")
                    .font(.system(size: 64))
                    .foregroundStyle(AppTheme.textSecondary)
                Text("Scan")
                    .font(.title2)
                    .foregroundStyle(AppTheme.textPrimary)
                Text("Document scanning coming soon.\nUse Upload from load details for now.")
                    .font(.subheadline)
                    .foregroundStyle(AppTheme.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding()
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(AppTheme.background)
            .navigationTitle("Scan")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
