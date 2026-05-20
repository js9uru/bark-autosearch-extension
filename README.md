## ZabaSearch / ThatsThem Sidepanel Extension

Chrome sidepanel extension to automate lead lookups and write results back to Google Sheets.

### Features

- **Google**: Extract full names from Google search results (uses OpenAI).
- **Search ThatsThem**: For each name, open ThatsThem and find matching **emails/phones** (supports masked/redacted rows).
- **Auto Search** (Google Sheets queue):
  - Reads the top N rows and picks the first `Status = Todo`
  - Sets it to `In progress`
  - Builds a search criteria string and runs Google name extraction
  - Runs ThatsThem matching for extracted names
  - Writes matched contacts to `Bark_Contacts`
  - Updates the original row `Status` to `Found` / `No found`

### Install / Load

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder: `D:\zabasearch`

### Required files (Google Sheets access)

Place your service account JSON key here:

- `D:\zabasearch\service_account.json`

Then share your Google Sheet with the service account email (Editor permission).

Security note: keep `service_account.json` local only (it is ignored by `.gitignore`).

### Settings (OpenAI key)

Go to the extension **Settings** tab, enter your OpenAI API key, and click **Save settings**. This is required for the **Google** name extraction.

### Auto Search (how it works)

#### 1) Pick a lead row from Google Sheets

- Reads **top 100** rows from the configured source sheet tab.
- Finds the first row where `Status` is `Todo`.
- Updates that row’s status to `In progress`.

#### 2) Build search criteria

Criteria format:

`{Name} living in {City, ST, ZIP}; {AreaCode}-`

Notes:
- `{Name}` comes from the picked row’s `Name` column (full value).
- Location is normalized to `City, ST, ZIP` and removes any parenthetical like `(Online/Remote)`.

#### 3) Google extraction (full pagination)

- Opens an **inactive Google tab** for the criteria
- Crawls all result pages
- Extracts full names
- Shows the **current Google page number** while running
- Closes the Google tab after extraction completes

#### 4) ThatsThem matching

- Opens a ThatsThem URL per extracted name
- Matches emails/phones using your patterns
- Shows matches in the **Results** panel

#### 5) Write to `Bark_Contacts`

If matches were found:

- Creates `Bark_Contacts` tab if missing
- Inserts a new row at the top (row 2)
- Writes **all matched emails** and **all matched phones** (newline-separated)
- `Added At` is written in your **local machine timezone**

#### 6) Update original row status

- If contacts were written: `In progress` → `Found`
- If no matches: `In progress` → `No found`

### Auto Search scheduling + stop behavior

- Runs one cycle immediately, then every **`AUTO_SEARCH_INTERVAL_MINUTES`** (see `sidebar-thatsthem.js`).
- **No overlap**: if the previous cycle is still running, the next tick is skipped.
- Click **Stop Auto Search**:
  - stops scheduling new cycles immediately
  - lets the current cycle finish successfully

### Google Sheet columns expected (source tab)

Auto Search expects these headers in the source sheet tab:

- `Name`
- `Service`
- `Location`
- `Phone`
- `Email`
- `Verified Phone`
- `Details Q&A`
- `Status`

`Bark_Contacts` is written without `Status`.

### Troubleshooting

- **“Missing service_account.json”**: ensure `D:\zabasearch\service_account.json` exists and reload the extension.
- **Sheets 403/401**: share the spreadsheet with the service account email (Editor).
- **Google extraction issues**: Google may show consent/captcha; try running again or log in to Google in your browser profile.

