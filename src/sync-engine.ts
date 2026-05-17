import { Notice, TFile, Vault } from 'obsidian';
import { DifyClient } from './dify-client';
import type DifySyncPlugin from './main';

/** Mapping file: obsidianPath -> difyDocumentId */
interface PathMapping {
  [obsidianPath: string]: string;
}

export class SyncEngine {
  private plugin: DifySyncPlugin;
  private client: DifyClient | null = null;
  private mapping: PathMapping = {};
  private syncing = false;

  constructor(plugin: DifySyncPlugin) {
    this.plugin = plugin;
  }

  getClient(): DifyClient {
    if (!this.client) {
      this.client = new DifyClient(
        this.plugin.settings.endpoint,
        this.plugin.settings.apiKey,
        this.plugin.settings.datasetId
      );
    }
    return this.client;
  }

  invalidateClient(): void {
    this.client = null;
  }

  private isInScope(file: TFile): boolean {
    const folder = this.plugin.settings.syncFolder;
    if (folder === '/' || folder === '') return true;
    const normalized = folder.endsWith('/') ? folder : folder + '/';
    return file.path.startsWith(normalized);
  }

  /** Load the path→docId mapping from data.json */
  async loadMapping(): Promise<void> {
    const data = (await this.plugin.loadData()) as Record<string, unknown> | null;
    if (data && data.mapping) {
      this.mapping = data.mapping as PathMapping;
    }
  }

  /** Save the path→docId mapping to data.json */
  async saveMapping(): Promise<void> {
    await this.plugin.saveData({ mapping: this.mapping });
  }

  /** Default sync: create a new document */
  async onFileCreated(file: TFile): Promise<void> {
    if (this.syncing || !this.isInScope(file)) return;
    if (this.mapping[file.path]) return; // already synced

    const settings = this.plugin.settings;
    if (!settings.endpoint || !settings.apiKey || !settings.datasetId) return;

    try {
      this.syncing = true;
      const content = await this.plugin.app.vault.read(file);
      const name = file.basename + '.' + file.extension;

      const resp = await this.getClient().createDocument(name, content, settings.docLanguage);
      this.mapping[file.path] = resp.document.id;
      await this.saveMapping();

      new Notice(`Dify Sync: Created "${name}"`);
    } catch (e) {
      console.error('Dify Sync: create failed for', file.path, e);
      new Notice(`Dify Sync: Failed to create "${file.basename}"`);
    } finally {
      this.syncing = false;
    }
  }

  /** File content changed → update Dify document */
  async onFileModified(file: TFile): Promise<void> {
    if (this.syncing || !this.isInScope(file)) return;

    const docId = this.mapping[file.path];
    if (!docId) {
      // Not yet synced — treat as create
      await this.onFileCreated(file);
      return;
    }

    const settings = this.plugin.settings;
    if (!settings.endpoint || !settings.apiKey || !settings.datasetId) return;

    try {
      this.syncing = true;
      const content = await this.plugin.app.vault.read(file);
      const name = file.basename + '.' + file.extension;

      await this.getClient().updateDocument(docId, name, content, settings.docLanguage);
      console.log(`Dify Sync: Updated "${name}"`);
    } catch (e) {
      console.error('Dify Sync: update failed for', file.path, e);
      new Notice(`Dify Sync: Failed to update "${file.basename}"`);
    } finally {
      this.syncing = false;
    }
  }

  /** File deleted → remove from Dify */
  async onFileDeleted(file: TFile): Promise<void> {
    if (this.syncing || !this.isInScope(file)) return;

    const docId = this.mapping[file.path];
    if (!docId) return;

    const settings = this.plugin.settings;
    if (!settings.endpoint || !settings.apiKey || !settings.datasetId) return;

    try {
      this.syncing = true;
      await this.getClient().deleteDocument(docId);
      delete this.mapping[file.path];
      await this.saveMapping();

      new Notice(`Dify Sync: Deleted "${file.basename}"`);
    } catch (e) {
      console.error('Dify Sync: delete failed for', file.path, e);
      new Notice(`Dify Sync: Failed to delete "${file.basename}"`);
    } finally {
      this.syncing = false;
    }
  }

  /** File renamed → delete old Dify doc + create new (Dify has no rename API) */
  async onFileRenamed(file: TFile, oldPath: string): Promise<void> {
    if (this.syncing) return;

    const oldDocId = this.mapping[oldPath];
    const settings = this.plugin.settings;
    const inScope = this.isInScope(file);
    const wasInScope = (() => {
      const folder = settings.syncFolder;
      if (folder === '/' || folder === '') return true;
      const normalized = folder.endsWith('/') ? folder : folder + '/';
      return oldPath.startsWith(normalized);
    })();

    if (!settings.endpoint || !settings.apiKey || !settings.datasetId) return;

    try {
      this.syncing = true;

      // Delete old document if it existed
      if (oldDocId && wasInScope) {
        await this.getClient().deleteDocument(oldDocId);
        delete this.mapping[oldPath];
      }

      // Create new document if now in scope
      if (inScope && file instanceof TFile) {
        const content = await this.plugin.app.vault.read(file);
        const name = file.basename + '.' + file.extension;
        const resp = await this.getClient().createDocument(name, content, settings.docLanguage);
        this.mapping[file.path] = resp.document.id;
      }

      await this.saveMapping();
      new Notice(`Dify Sync: Renamed "${file.basename}"`);
    } catch (e) {
      console.error('Dify Sync: rename failed', oldPath, '→', file.path, e);
      new Notice(`Dify Sync: Failed to handle rename`);
    } finally {
      this.syncing = false;
    }
  }

  /** One-shot full sync: push all Obsidian files to Dify */
  async fullSync(): Promise<void> {
    const settings = this.plugin.settings;
    if (!settings.endpoint || !settings.apiKey || !settings.datasetId) {
      new Notice('Dify Sync: Please configure API endpoint and key first.');
      return;
    }

    this.syncing = true;
    const notice = new Notice('Dify Sync: Starting full sync...', 0);
    let created = 0;
    let updated = 0;
    let deleted = 0;

    try {
      // Fetch all existing Dify documents
      let difyDocs: { id: string; name: string }[];
      try {
        const allDocs = await this.getClient().listAllDocuments();
        difyDocs = allDocs.map(d => ({ id: d.id, name: d.name }));
      } catch (e) {
        console.error('Dify Sync: Failed to list Dify documents', e);
        new Notice('Dify Sync: Failed to connect. Check your settings.');
        return;
      }

      const difyByName = new Map<string, string>();
      for (const d of difyDocs) {
        difyByName.set(d.name, d.id);
      }

      // Get all Obsidian markdown files in scope
      const files = this.plugin.app.vault.getMarkdownFiles()
        .filter(f => this.isInScope(f));

      const obsidianNames = new Set<string>();
      const newMapping: PathMapping = {};

      // Create/Update
      for (const file of files) {
        const name = file.basename + '.' + file.extension;
        obsidianNames.add(name);

        const existingDocId = difyByName.get(name) || this.mapping[file.path];
        const content = await this.plugin.app.vault.read(file);

        if (existingDocId) {
          // Update existing
          await this.getClient().updateDocument(existingDocId, name, content, settings.docLanguage);
          updated++;
        } else {
          // Create new
          const resp = await this.getClient().createDocument(name, content, settings.docLanguage);
          newMapping[file.path] = resp.document.id;
          created++;
          continue;
        }

        newMapping[file.path] = existingDocId;
      }

      // Delete docs that are on Dify but not in Obsidian
      difyByName.forEach(async (docId, name) => {
        if (!obsidianNames.has(name)) {
          try {
            await this.getClient().deleteDocument(docId);
            deleted++;
          } catch (e) {
            console.error('Dify Sync: Failed to delete stale doc', name, e);
          }
        }
      });

      this.mapping = newMapping;
      await this.saveMapping();

      notice.hide();
      new Notice(`Dify Sync: ${created} created, ${updated} updated, ${deleted} deleted`);
    } catch (e) {
      notice.hide();
      console.error('Dify Sync: Full sync failed', e);
      new Notice('Dify Sync: Full sync failed. See console for details.');
    } finally {
      this.syncing = false;
    }
  }
}
