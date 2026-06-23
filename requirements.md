# Product Requirements Document (PRD)

## Project Title: Shared Travel Planner PWA

**Target Environment:** Pure Client-Side Progressive Web App (PWA)

**Tech Stack:** Vanilla JavaScript (ES Modules), Tailwind CSS, DaisyUI (via CDN)

**Database Backend:** Google Sheets (Relational Architecture via Sheets API)

**Authentication:** Google Identity Services (OAuth 2.0 Client-Side Token Client)

---

## 1. Project Overview & Objective

The goal is to build a high-performance, mobile-first, collaborative travel itinerary planning application. The application operates entirely serverless on the client side, leveraging a single shared Google Sheet as its relational database.

Multiple authenticated users can view, add, and modify trip components simultaneously. The UI must feel like a premium, modern native app, prioritizing scannability, color-coded categorization, and clear timeline mapping.

---

## 2. Technical Architecture & Data Engine

### 2.1 Storage & Relational Database Design

The application utilizes **one** Google Sheet file containing two separate tabs acting as database tables.

* **Unique IDs:** Do not use auto-increment keys. The PWA client must generate a unique identifier using `crypto.randomUUID()` when creating any record.

#### Tab 1: `Users`

Tracks trip participants.

| Column Index | Field Name | Data Type | Description |
| --- | --- | --- | --- |
| **A** | `UserID` | String (UUID) | Primary Key (`PK`) |
| **B** | `Name` | String | User's full display name |
| **C** | `Email` | String | User's Google account email |

#### Tab 2: `Tasks` (Itinerary Items)

Tracks all travel nodes, accommodation, and activities.

| Column Index | Field Name | Data Type | Description |
| --- | --- | --- | --- |
| **A** | `TaskID` | String (UUID) | Primary Key (`PK`) |
| **B** | `AssignedUserID` | String (UUID) | Foreign Key (`FK`) referencing `Users.UserID` |
| **C** | `Type` | String | Enum: `Travel`, `Accommodation`, `Activity`, `Global` |
| **D** | `Title` | String | Name of the event / item |
| **E** | `StartDateTime` | String (ISO 8601) | Event departure/check-in/start |
| **F** | `EndDateTime` | String (ISO 8601) | Event arrival/check-out/end |
| **G** | `FromLocation` | String | Departure string or starting landmark |
| **H** | `ToLocation` | String | Destination string or ending landmark |
| **I** | `Notes` | String | Markdown text, booking references, or packing text |

### 2.2 Authentication & Security Strategy

* **Security Principle:** Absolutely **no** Google Cloud Service Account JSON keys or Private API keys may be bundled in the client code.
* **OAuth 2.0 Flow:** Use the modern **Google Identity Services SDK** (`google.accounts.oauth2.initTokenClient`) combined with the **Google APIs Client Library** (`gapi.js`).
* **Access Control:** The PWA acts on behalf of the signed-in user. The trip creator initializes the Google Sheet and shares it directly (Editor access) with friends via Google Drive. If a user logs into the PWA but does not have shared permission on the Sheet ID, the API safely rejects requests with a `403 Forbidden` error.

---

## 3. Core Functional Requirements

* **PWA Compliance:** Must contain a valid `manifest.json` and a Service Worker (`sw.js`) that caches structural assets (`index.html`, `js/`, `css/`) to allow offline loading.
* **Relational Joins:** The client must fetch both sheets using a single optimized `batchGet` call, then perform client-side matching (`Tasks.AssignedUserID` $\rightarrow$ `Users.UserID`) to display clean usernames on UI components.
* **Data Entry Rule:** When saving a record, coordinates/locations must support a string input that maps cleanly to native map rendering.

---

## 4. UI/UX & Design Specification

### 4.1 Global Visual Design Tokens (DaisyUI + Tailwind)

Maintain a strict color scheme for quick scannability across the UI:

* **Global Layout Theme:** Dark luxury background or high-contrast modern clean aesthetic (`bg-base-200`).
* **Categorization Mapping:**
* `Travel`: Deep Ocean Blue (`bg-blue-600` / Text: `#1a73e8`) -> Icon: ✈️ / 🚆
* `Accommodation`: Emerald Green (`bg-success` / Text: `#0f9d58`) -> Icon: 🏨 / 🏠
* `Activity`: Sunset Orange (`bg-warning` / Text: `#f4b400`) -> Icon: 🎡 / 🍽️



### 4.2 Core Screen Requirements

#### 1. Main Dashboard View

* **Header Module:** Show Trip Title, Global Date range, and an overlapping **Participant Avatar Stack** (`flex -space-x-2`).
* **Toggle Control:** A DaisyUI `.join` segmented button block toggling between `[ 📅 Calendar ]` and `[ 📝 Agenda ]`.
* **Views:**
* *Calendar Mode:* A 7-column CSS Grid monthly block showing the trip span. Days containing tasks contain small indicator dots matching the color tokens.
* *Agenda Mode:* Chronological list grouped by day headers. Rows display as cards with colored left borders (`border-l-4`).


* **Floating Action Button (FAB):** Persistent fixed circle button (`fixed bottom-5 right-5 z-50 btn-circle btn-primary`) with a `+` icon to open the creation dialog.

#### 2. Expanded Day Detail View

* Accessible by clicking any day cell or header from the main dashboard.
* Features a horizontal navigation bar (`<- Day 3: June 24 ->`) supporting sequential pagination.
* Displays a split viewport:
* **Top half:** A vertical timeline layout stretching from morning to night. Scheduled items map visually as time blocks matching the item color tokens.
* **Bottom half:** An embedded interactive **Google Maps Canvas component** rendering route geometry or pins based on the items present on that specific day.



#### 3. Item Detail & Edit View

* **Read State:** Displays full card data including Title, Start/End explicit timings, path routing (`From Location -> To Location`), a rich Markdown-compatible notes paragraph, and an avatar showing who created it.
* **Edit State:** Initiated by clicking an `.btn-outline` edit modifier. Transforms static text nodes into form components: text inputs, standard `<select>` dropdowns for type, and native datetime controls. Saving maps updates back to the target row index.

#### 4. Global Search & Filter Screen

* Features a sticky header (`sticky top-0 z-40`) housing an input field with live keyup string matching.
* Under the search box, render a row of horizontally scrollable filter chips (`overflow-x-auto whitespace-nowrap`) allowing filtering by `Type` or `Day`.
* Results stream down as a simplified vertical feed sorted by date.

---

## 5. Instructions for AI Coding Agent

When translating this specification into operational code, adhere strictly to the following implementation structure:

1. **Zero Build Pipeline:** Write clean vanilla JavaScript modules using ES module imports (`import/export`). Do not introduce node build dependencies or transpilation requirements. Load Tailwind CSS and DaisyUI fully via upstream CDNs.
2. **File Isolation Protocol:** Keep code strictly divided into the structure provided below:
* `index.html`: Contains structural layout, DaisyUI theme injectors, and Google CDN script attachments (`/gsi/client` and `/js/api.js`).
* `js/auth.js`: Implements OAuth client initialization (`initTokenClient`) and exposes clean functions for login, token verification, and logout tracking.
* `js/sheets.js`: Controls GAPI connections. Must contain `batchGet` array queries for unified reads, and `append`/`update` row formatting.
* `js/app.js`: Connects your asynchronous sheets response matrices to browser DOM manipulation operations, triggering state changes based on input events.


3. **Graceful Degraded States:** Ensure the code checks for network dropouts. Implement try/catch blocks on every spreadsheet payload request so that if network sync drops out, the application warns the user with a DaisyUI alert banner rather than throwing a fatal uncaught JavaScript exception.
