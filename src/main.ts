import { Notice, Plugin, TAbstractFile, TFile } from 'obsidian';
import { DifySyncSettings, DEFAULT_SETTINGS } from './settings';
import { DifySyncSettingTab } from './settings-ui';
import { SyncEngine } from './sync-engine';

export default class DifySyncPlugin extends Plugin {
  settings!: DifySyncSettings;
  syncEngine!: SyncEngine;
  private eventRefs: (() => void)[] = [];

  async onload(): Promise<void> {
    // Load settings
    await this.loadSettings();

    // Initialize sync engine
    this.syncEngine = new SyncEngine(this);
    await this.syncEngine.loadMapping();

    // Register settings tab
    this.addSettingTab(new DifySyncSettingTab(this.app, this));

    // Register commands
    this.addCommand({
      id: 'full-sync',
      name: 'Full sync to Dify',
      callback: () => this.syncEngine.fullSync(),
    });

    this.addCommand({
      id: 'sync-current-file',
      name: 'Sync current file to Dify',
      editorCallback: async (_editor, view) => {
        if (view.file) {
          await this.syncEngine.onFileModified(view.file);
        } else {
          new Notice('Dify Sync: No file open');
        }
      },
    });

    // Register test connection command
    this.addCommand({
      id: 'test-connection',
      name: 'Test Dify connection',
      callback: async () => {
        const ok = await this.syncEngine.getClient().testConnection();
        if (ok) {
          new Notice('Dify Sync: Connection OK ✓');
        } else {
          new Notice('Dify Sync: Connection FAILED ✗');
        }
      },
    });

    // If auto-sync was on, start it
    if (this.settings.autoSync) {
      this.startAutoSync();
    }

    // Status bar
    const statusBar = this.addStatusBarItem();
    statusBar.createEl('span', { text: '📡 Dify Sync' });
  }

  onunload(): void {
    this.stopAutoSync();
  }

  // ─── Settings ────────────────────────────────────────────────

  async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as Record<string, unknown> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings);
  }

  async saveSettings(): Promise<void> {
    // Preserve mapping when saving settings
    const existingData = (await this.loadData()) as Record<string, unknown> | null;
    await this.saveData({
      settings: this.settings,
      mapping: existingData?.mapping ?? {},
    });
    // Invalidate client so it picks up new settings
    this.syncEngine.invalidateClient();
  }

  // ─── Auto-sync event wiring ─────────────────────────────────

  startAutoSync(): void {
    this.stopAutoSync();

    const vault = this.app.vault;

    // Attach via registerEvent so cleanup is automatic
    const onModify = (...args: unknown[]) => {
      const file = args[0] as TAbstractFile;
      if (file instanceof TFile) {
        this.syncEngine.onFileModified(file);
      }
    };

    const onDelete = (...args: unknown[]) => {
      const file = args[0] as TAbstractFile;
      if (file instanceof TFile) {
        this.syncEngine.onFileDeleted(file);
      }
    };

    const onRename = (...args: unknown[]) => {
      const file = args[0] as TAbstractFile;
      const oldPath = args[1] as string;
      if (file instanceof TFile) {
        this.syncEngine.onFileRenamed(file, oldPath);
      }
    };

    // Hook vault events
    vault.on('create', onModify);
    vault.on('modify', onModify);
    vault.on('delete', onDelete);
    vault.on('rename', onRename);

    // Store for cleanup
    this.eventRefs = [
      () => vault.off('create', onModify),
      () => vault.off('modify', onModify),
      () => vault.off('delete', onDelete),
      () => vault.off('rename', onRename),
    ];
  }

  stopAutoSync(): void {
    for (const off of this.eventRefs) off();
    this.eventRefs = [];
  }

  // ─── Data save override ─────────────────────────────────────

  async saveData(data: unknown): Promise<void> {
    await super.saveData(data);
  }

  async loadData(): Promise<unknown> {
    return super.loadData();
  }
}
