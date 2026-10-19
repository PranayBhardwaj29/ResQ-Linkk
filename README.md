# 🚨 ResQLink — Smart Disaster Rescue & Emergency Response

**ResQLink** is a disaster-response and emergency assistance platform designed to help people access essential rescue resources, communicate emergency information, and locate nearby shelters during disasters.

Built with a focus on accessibility, real-time information, and mobile usability, ResQLink aims to make emergency assistance more organized and accessible when it matters most.

## 🌍 Problem Statement

During natural disasters and other emergencies, people may struggle to find nearby shelters, communicate their location, and access reliable rescue information. Network disruptions can make these challenges even harder.

ResQLink aims to bring essential emergency-response features together in one accessible platform.

## ✨ Key Features

* 🆘 **SOS Assistance** — Access emergency assistance through the SOS interface.
* 🗺️ **Interactive Map** — View relevant locations and rescue resources.
* 🏠 **Shelter Discovery** — Access information about available shelters.
* 📢 **Emergency Feed** — View and share disaster-related updates.
* 🧭 **Digital Compass** — Get directional guidance when navigating.
* 🤝 **NGO & Rescue Support** — Access NGO-related and rescue coordination features.
* 🐟 **Live Relief Web Scraper (TinyFish)** — Real-time discovery of official disaster warnings, relief news, and emergency shelters across the open web.
* 📱 **Android Application** — Built using Capacitor / WebViewAssetLoader to bring the web application to Android.
* **Mesh Networking** - Helps to connect people with p2p network 
* 🔄 **Data Synchronization** — Backend API support for synchronizing application data.

> Note: Feature availability and behavior depend on the current implementation and configured services.

## 🛠️ Tech Stack

| Technology           | Purpose                                             |
| -------------------- | --------------------------------------------------- |
| React                | User interface                                      |
| TypeScript           | Type-safe development                               |
| Vite                 | Development server and build tool                   |
| TinyFish             | Live web agents, relief search, and page extraction |
| Capacitor / Android  | Android application integration (native mesh & web) |
| Supabase             | Backend and data services / Edge functions          |
| Node.js / Express    | Server-side runtime & coordinator                   |
| Google Gemini        | AI triage analysis & bilingual situation summary    |
| Git & GitHub         | Version control and collaboration                   |

## 🏗️ Project Architecture

```text
ResQLink/
├── src/                 # React application
├── public/              # Static assets
├── server/              # Server-side code
├── android/             # Native Android project
├── package.json         # Dependencies and scripts
├── vite.config.ts       # Vite configuration
├── capacitor.config.ts  # Capacitor configuration
└── README.md            # Project documentation
```

*The directory structure may vary depending on the current version of the project.*

## 🚀 Getting Started

### Prerequisites

Install the following before running the project:

* Node.js and npm
* Git
* Android Studio (for Android development)
* A Supabase project and required environment variables, if applicable

### 1. Clone the Repository

```bash
git clone https://github.com/bhumikaa0006-create/ResQLinkk.git
```

### 2. Navigate to the Project

```bash
cd ResQLinkk
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Configure Environment Variables

Create a `.env` file in the project root and add the variables required by your application.

```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

Use the exact variable names expected by your existing code. Never commit private API keys, passwords, or service-role keys to GitHub.

### 5. Start the Development Server

```bash
npm run dev
```

Open the local URL displayed in your terminal.

### 6. Build the Application

```bash
npm run build
```

### 7. Run on Android

After configuring Capacitor and the Android project:

```bash
npx cap sync android
npx cap open android
```

Use Android Studio to build and run the application on an emulator or a connected Android device.

## 🐟 TinyFish Integration (ResQ Linkk AI Coordinator)

ResQ Linkk integrates **TinyFish** to autonomously scrape and stream live disaster relief information from the open web directly to responders and citizens:

### TinyFish Products Used & Purpose

1. **TinyFish Web Agent** (`POST https://agent.tinyfish.ai/v1/automation/run`):
   - Autonomous natural-language web browsing for government disaster portals and state boards that lack public APIs (e.g. NDMA, Delhi DUSIB, and USDMA).
   - Scrapes structured shelter data with goal:
     `"Find the list of active relief camps or shelters on this page. Return JSON array: [{name, district, address, capacity, status, contact}]."`
   - Scrapes active warnings with goal:
     `"Extract the current disaster warnings on this page. Return JSON array: [{title, hazard, severity, area, issued_at, summary}]."`
   - Features 120s timeout, exponential backoff retry, and defensive multi-format JSON parsers.

2. **TinyFish Search API** (`GET https://api.search.tinyfish.ai`):
   - Real-time search with recency filtering (`recency_minutes: 1440`, `domain_type: news`) to discover breaking flood, cyclone, landslide, and heatwave alerts for the user's selected region.
   - Ultra-fast 1–3s latency for immediate hazard alerts.

3. **TinyFish Fetch API** (`POST https://api.fetch.tinyfish.ai`):
   - High-speed extraction of clean markdown text from official disaster advisories, stripping HTML boilerplate for immediate AI parsing and situation briefing generation.

### Configuration & Security

- **Server-Side Module Only**: The TinyFish module lives strictly on the server (`web-source/server/tinyfish.ts` and Supabase Edge Function `supabase/functions/tinyfish-relief/index.ts`).
- `TINYFISH_API_KEY` is never exposed in client bundles and never placed in any `VITE_` variable or committed files.
- To set the key for the Express backend coordinator:
  ```bash
  # Inside web-source/server/.env (ignored by git):
  TINYFISH_API_KEY=your_tinyfish_api_key_here
  ```
- To set the key for Supabase Edge Functions:
  ```bash
  supabase secrets set TINYFISH_API_KEY=your_tinyfish_api_key_here
  ```

### Anti-Misinformation & Domain Verification

To protect disaster victims from panic and fake relief news, ResQ Linkk validates every scraped URL against an official domain allow-list:
- Official domains (`ndma.gov.in`, `imd.gov.in`, `ddma.delhi.gov.in`, `usdma.uk.gov.in`, `*.gov.in`, `*.nic.in`) receive a green **Verified Official** shield.
- Unverified community or public web sources receive an amber **Unverified Web** badge.
- Results are deduplicated on `(source_url, title)` in the Supabase `live_relief_feed` table.

### Live Demo & Verification Script

Run the standalone verification test script to inspect Search, Fetch, and Web Agent extraction in your console:
```bash
npx --yes tsx scripts/test-tinyfish.ts
```

## 🔐 Security & Reliability

* Keep credentials and private keys out of source control.
* Validate incoming API requests.
* Handle network failures and unavailable services gracefully.
* Clearly distinguish verified emergency information from unverified user-submitted reports.
* Test emergency-related features before relying on them in real-world situations.

## 🗺️ Roadmap

* [ ] Improve offline access to essential emergency information.
* [ ] Enhance disaster-report classification using NLP.
* [ ] Improve shelter and rescue-resource verification.
* [ ] Strengthen synchronization during unreliable connectivity.
* [ ] Explore nearby-device communication for situations with limited internet access.
* [ ] Improve accessibility and the Android user experience.

## 🤝 Contributing

Contributions, suggestions, and bug reports are welcome.

1. Fork the repository.
2. Create a feature branch.
3. Make your changes.
4. Test your implementation.
5. Open a pull request describing your changes.


## ⚠️ Disclaimer

ResQLink is a technology project intended to support emergency awareness and coordination. It does not replace official emergency services, verified rescue instructions, or professional emergency responders.

---

**Built with the goal of making emergency assistance more accessible when every second matters.** ❤️‍🩹
