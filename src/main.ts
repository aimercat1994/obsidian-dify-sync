import { Notice, Plugin, TAbstractFile, TFile } from 'obsidian';
import { DifySyncSettings, DEFAULT_SETTINGS } from './settings';
import { DifySyncSettingTab } from './settings-ui';
import { SyncEngine } from './sync-engine';

export default class DifySyncPlugin extends Plugin {
  settings!: DifySyncSettings;
  syncEngine!: SyncEngine;
  private eventRefs: (() => void)[] = [];

  async onload(): Promise<void> {
    await this.loadSettings();

    this.syncEngine = new SyncEngine(this);
    await this.syncEngine.loadMapping();

    this.addSettingTab(new DifySyncSettingTab(this.app, this));

    this.addCommand({
      id: 'full-sync',
      name: '全量同步到 Dify',
      callback: () => this.syncEngine.fullSync(),
    });

    this.addCommand({
      id: 'incremental-sync',
      name: '增量同步到 Dify',
      callback: () => this.syncEngine.incrementalSync(),
    });

    this.addCommand({
      id: 'sync-current-file',
      name: '同步当前文件到 Dify',
      editorCallback: async (_editor, view) => {
        if (view.file) {
          await this.syncEngine.onFileModified(view.file);
        } else {
          new Notice('Dify Sync：未打开文件');
        }
      },
    });

    this.addCommand({
      id: 'test-connection',
      name: '测试 Dify 连接',
      callback: async () => {
        const ok = await this.syncEngine.getClient().testConnection();
        new Notice(ok ? 'Dify Sync：连接成功 ✓' : 'Dify Sync：连接失败 ✗');
      },
    });

    if (this.settings.autoSync) {
      this.startAutoSync();
    }

    const statusBar = this.addStatusBarItem();
    statusBar.createEl('span', { text: '📡 Dify 同步' });
  }

  onunload(): void {
    this.stopAutoSync();
  }

  // ─── 设置 ────────────────────────────────────────────────────

  async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as Record<string, unknown> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings);
  }

  async saveSettings(): Promise<void> {
    const existingData = (await this.loadData()) as Record<string, unknown> | null;
    await this.saveData({
      settings: this.settings,
      mapping: existingData?.mapping ?? {},
    });
    this.syncEngine.invalidateClient();
  }

  // ─── 自动同步事件 ────────────────────────────────────────────

  startAutoSync(): void {
    this.stopAutoSync();

    const vault = this.app.vault;

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

    vault.on('create', onModify);
    vault.on('modify', onModify);
    vault.on('delete', onDelete);
    vault.on('rename', onRename);

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

  async saveData(data: unknown): Promise<void> {
    await super.saveData(data);
  }

  async loadData(): Promise<unknown> {
    return super.loadData();
  }
}
