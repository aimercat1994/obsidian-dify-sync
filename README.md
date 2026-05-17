# Obsidian Dify Sync

Sync your Obsidian notes to [Dify](https://dify.ai) knowledge base. Creates, updates, and deletes documents in Dify to mirror your vault — Obsidian is the source of truth.

## Features

- **Automatic sync** — files created/modified/deleted in Obsidian are synced to Dify in real time
- **Full sync** — one-click push all notes to Dify, and prune stale documents on the Dify side
- **Smart rename** — handles file renames by deleting the old Dify doc and creating a new one
- **Folder scoping** — sync only a specific subfolder or the entire vault
- **Manual control** — commands for syncing individual files or running a full sync

## Installation

### From source

```bash
cd /path/to/your-vault/.obsidian/plugins/
git clone https://github.com/aimercat1994/obsidian-dify-sync.git
cd obsidian-dify-sync
npm install
npm run build
```

Then enable the plugin in Obsidian: **Settings → Community plugins → Dify Sync**.

### From Obsidian Community Plugins (coming soon)

Once reviewed and published, you'll be able to install it directly from the Community Plugins browser.

## Configuration

1. In Dify, go to **Knowledge → Service API** (top-right corner)
2. Copy the **API Endpoint** (e.g. `http://your-dify-instance/v1`)
3. Click **API Key** → create a new key and copy it
4. Open the knowledge base you want to sync to, copy its **Knowledge Base ID** from the URL

5. In Obsidian, go to **Settings → Dify Sync** and fill in:

| Setting | Description |
|---------|-------------|
| Dify API Endpoint | Your Dify base URL, e.g. `http://192.168.1.10:1180/v1` |
| Knowledge Base API Key | The API key from Dify's Service API panel |
| Knowledge Base ID | The dataset UUID |
| Sync Folder | Vault folder to sync (`/` = entire vault) |
| Document Language | Language hint for Dify processing |
| Auto Sync | Enable real-time sync on file changes |

6. Click **Sync Now** to perform the initial full sync

## Usage

### Commands

| Command | Action |
|---------|--------|
| `Dify Sync: Full sync to Dify` | Push all notes in the configured folder to Dify, remove stale docs |
| `Dify Sync: Sync current file` | Sync the currently open note |
| `Dify Sync: Test connection` | Verify that the Dify API is reachable |

### Auto Sync

When enabled, the plugin listens to vault events:

- **Create/Modify** → creates or updates the document in Dify
- **Delete** → removes the document from Dify
- **Rename** → deletes the old document and creates a new one (Dify has no rename API)

## How It Works

```
Obsidian Vault (source of truth)
         │
         ├─ create/modify → POST /v1/datasets/{id}/document/create-by-text
         │                  POST /v1/datasets/{id}/documents/{docId}/update-by-text
         │
         ├─ delete ───────→ DELETE /v1/datasets/{id}/documents/{docId}
         │
         └─ rename ───────→ DELETE old + POST new
```

A local `path → dify_document_id` mapping is stored in the plugin's `data.json` to avoid creating duplicates.

### Dify API Endpoints Used

| Operation | Method | Endpoint |
|-----------|--------|----------|
| List documents | `GET` | `/datasets/{dataset_id}/documents` |
| Create document | `POST` | `/datasets/{dataset_id}/document/create-by-text` |
| Update document | `POST` | `/datasets/{dataset_id}/documents/{document_id}/update-by-text` |
| Delete document | `DELETE` | `/datasets/{dataset_id}/documents/{document_id}` |

## Requirements

- Obsidian **v1.5.0** or later
- Dify (self-hosted or cloud) with a knowledge base created
- Node.js 18+ (for building from source)

## Development

```bash
# Install dependencies
npm install

# Watch mode (auto-rebuild on changes)
npm run dev

# Production build
npm run build
```

Use [Hot-Reload](https://github.com/pjeby/hot-reload) plugin for automatic reloading during development.

## License

MIT
