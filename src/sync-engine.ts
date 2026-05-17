import { Notice, TFile } from 'obsidian';
import { DifyClient } from './dify-client';
import type DifySyncPlugin from './main';

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

  async loadMapping(): Promise<void> {
    const data = (await this.plugin.loadData()) as Record<string, unknown> | null;
    if (data && data.mapping) {
      this.mapping = data.mapping as PathMapping;
    }
  }

  async saveMapping(): Promise<void> {
    await this.plugin.saveData({ mapping: this.mapping });
  }

  /** 新建文件 → 在 Dify 中创建文档 */
  async onFileCreated(file: TFile): Promise<void> {
    if (this.syncing || !this.isInScope(file)) return;
    if (this.mapping[file.path]) return;

    const settings = this.plugin.settings;
    if (!settings.endpoint || !settings.apiKey || !settings.datasetId) return;

    try {
      this.syncing = true;
      const content = await this.plugin.app.vault.read(file);
      const name = file.basename + '.' + file.extension;

      const resp = await this.getClient().createDocument(name, content, settings.docLanguage);
      this.mapping[file.path] = resp.document.id;
      await this.saveMapping();

      new Notice(`Dify Sync：已创建「${name}」`);
    } catch (e) {
      console.error('Dify Sync：创建失败', file.path, e);
      new Notice(`Dify Sync：创建「${file.basename}」失败`);
    } finally {
      this.syncing = false;
    }
  }

  /** 文件修改 → 更新 Dify 文档 */
  async onFileModified(file: TFile): Promise<void> {
    if (this.syncing || !this.isInScope(file)) return;

    const docId = this.mapping[file.path];
    if (!docId) {
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
      console.log(`Dify Sync：已更新「${name}」`);
    } catch (e) {
      console.error('Dify Sync：更新失败', file.path, e);
      new Notice(`Dify Sync：更新「${file.basename}」失败`);
    } finally {
      this.syncing = false;
    }
  }

  /** 文件删除 → 删除 Dify 文档 */
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

      new Notice(`Dify Sync：已删除「${file.basename}」`);
    } catch (e) {
      console.error('Dify Sync：删除失败', file.path, e);
      new Notice(`Dify Sync：删除「${file.basename}」失败`);
    } finally {
      this.syncing = false;
    }
  }

  /** 文件重命名 → 删旧 + 建新 */
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

      if (oldDocId && wasInScope) {
        await this.getClient().deleteDocument(oldDocId);
        delete this.mapping[oldPath];
      }

      if (inScope && file instanceof TFile) {
        const content = await this.plugin.app.vault.read(file);
        const name = file.basename + '.' + file.extension;
        const resp = await this.getClient().createDocument(name, content, settings.docLanguage);
        this.mapping[file.path] = resp.document.id;
      }

      await this.saveMapping();
      new Notice(`Dify Sync：已重命名「${file.basename}」`);
    } catch (e) {
      console.error('Dify Sync：重命名失败', oldPath, '→', file.path, e);
      new Notice('Dify Sync：重命名处理失败');
    } finally {
      this.syncing = false;
    }
  }

  /** 全量同步 */
  async fullSync(): Promise<void> {
    const settings = this.plugin.settings;
    if (!settings.endpoint || !settings.apiKey || !settings.datasetId) {
      new Notice('Dify Sync：请先配置 API 端点和 Key');
      return;
    }

    this.syncing = true;
    const notice = new Notice('Dify Sync：正在全量同步…', 0);
    let created = 0;
    let updated = 0;
    let deleted = 0;

    try {
      let difyDocs: { id: string; name: string }[];
      try {
        const allDocs = await this.getClient().listAllDocuments();
        difyDocs = allDocs.map(d => ({ id: d.id, name: d.name }));
      } catch (e) {
        console.error('Dify Sync：获取 Dify 文档列表失败', e);
        notice.hide();
        new Notice('Dify Sync：连接失败，请检查设置');
        return;
      }

      const difyByName = new Map<string, string>();
      const difyDocIds = new Set<string>();
      for (const d of difyDocs) {
        difyByName.set(d.name, d.id);
        difyDocIds.add(d.id);
      }

      const files = this.plugin.app.vault.getMarkdownFiles()
        .filter(f => this.isInScope(f));

      const obsidianNames = new Set<string>();
      const newMapping: PathMapping = {};

      for (const file of files) {
        const name = file.basename + '.' + file.extension;
        obsidianNames.add(name);

        // 仅当 mapping 中的文档 ID 在当前知识库确实存在时才复用
        const mappingDocId = this.mapping[file.path];
        const existingDocId = difyByName.get(name) ||
          (mappingDocId && difyDocIds.has(mappingDocId) ? mappingDocId : undefined);
        const content = await this.plugin.app.vault.read(file);

        if (existingDocId) {
          await this.getClient().updateDocument(existingDocId, name, content, settings.docLanguage);
          updated++;
        } else {
          const resp = await this.getClient().createDocument(name, content, settings.docLanguage);
          newMapping[file.path] = resp.document.id;
          created++;
          continue;
        }

        newMapping[file.path] = existingDocId;
      }

      difyByName.forEach(async (docId, name) => {
        if (!obsidianNames.has(name)) {
          try {
            await this.getClient().deleteDocument(docId);
            deleted++;
          } catch (e) {
            console.error('Dify Sync：清理多余文档失败', name, e);
          }
        }
      });

      this.mapping = newMapping;
      await this.saveMapping();

      notice.hide();
      new Notice(`Dify Sync：新增 ${created}，更新 ${updated}，删除 ${deleted}`);
    } catch (e) {
      notice.hide();
      console.error('Dify Sync：全量同步失败', e);
      new Notice('Dify Sync：全量同步失败，详见控制台');
    } finally {
      this.syncing = false;
    }
  }
}
