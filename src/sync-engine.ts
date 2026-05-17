import { Notice, TFile } from 'obsidian';
import { DifyClient } from './dify-client';
import type DifySyncPlugin from './main';

interface PathEntry {
  docId: string;
  contentHash: string;
}

interface PathMapping {
  [obsidianPath: string]: string;  // old format
}

interface PathMappingV2 {
  [obsidianPath: string]: PathEntry;
}

/** Debounce 间隔（毫秒），期间内多次 modify 只触发一次上传 */
const MODIFY_DEBOUNCE_MS = 5000;

export class SyncEngine {
  private plugin: DifySyncPlugin;
  private client: DifyClient | null = null;
  private mapping: PathMappingV2 = {};
  private syncing = false;
  /** 并发取消标志，由取消命令设置 */
  private cancelFlag = false;
  /** 上次同步时间戳（毫秒），用于增量同步 */
  private lastSyncTime = 0;
  /** 防抖计时器：file.path → timeoutId */
  private debounceTimers = new Map<string, number>();
  /** 防抖期间有文件的 modify 被触发过 */
  private pendingModify = new Set<string>();

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

  /** 取消正在进行的同步 */
  cancelSync(): void {
    if (this.syncing) {
      this.cancelFlag = true;
      new Notice('Dify Sync：正在取消同步…');
    }
  }

  // ─── 并发池 ────────────────────────────────────────────────────

  /**
   * 并发执行异步任务，最多同时运行 concurrency 个。
   * 每次启动新任务前检查 cancelFlag，触发取消时跳过剩余任务。
   */
  private async runWithPool<T>(
    tasks: (() => Promise<T>)[],
    concurrency: number
  ): Promise<{ results: T[]; cancelled: boolean }> {
    const results: T[] = new Array(tasks.length);
    let nextIndex = 0;
    let cancelled = false;

    const worker = async (): Promise<void> => {
      while (nextIndex < tasks.length) {
        if (this.cancelFlag) {
          cancelled = true;
          return;
        }
        const i = nextIndex++;
        try {
          results[i] = await tasks[i]();
        } catch (e) {
          throw e;  // 向上抛给 Promise.all 处理
        }
      }
    };

    const workers = Array.from(
      { length: Math.min(concurrency, tasks.length) },
      () => worker()
    );

    await Promise.all(workers);
    return { results, cancelled: cancelled || this.cancelFlag };
  }

  // ─── 内容 Hash ─────────────────────────────────────────────────

  /** 对文本内容计算 SHA-256 hex 摘要 */
  private async hashContent(content: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // ─── 进度显示 ──────────────────────────────────────────────────

  /** 更新 Notice 文字和状态栏进度 */
  private updateProgress(notice: Notice, text: string): void {
    notice.setMessage(text);
    if (this.plugin.statusBarEl) {
      this.plugin.statusBarEl.setText(`📡 ${text}`);
    }
  }

  /** 重置状态栏为默认 */
  private resetStatusBar(): void {
    if (this.plugin.statusBarEl) {
      this.plugin.statusBarEl.setText('📡 Dify 同步');
    }
  }

  // ─── 文档命名 ──────────────────────────────────────────────────

  /** 路径级文档名（v2.0+）：用 Obsidian 全路径作为 Dify 文档名，同名文件不冲突 */
  private getDocName(file: TFile): string {
    return file.path;
  }

  /** 旧版文档名兼容（v1.x）：仅文件名，用于匹配未迁移的旧 Dify 文档 */
  private getOldDocName(file: TFile): string {
    return file.basename + '.' + file.extension;
  }

  // ─── 映射管理 ──────────────────────────────────────────────────

  async loadMapping(): Promise<void> {
    const data = (await this.plugin.loadData()) as Record<string, unknown> | null;
    if (!data || !data.mapping) return;

    const raw = data.mapping as Record<string, unknown>;

    // 检测旧格式 {path: "uuid"} 并升级
    const keys = Object.keys(raw);
    if (keys.length > 0) {
      const first = raw[keys[0]];
      if (typeof first === 'string') {
        // 旧格式 → 迁移
        const old = raw as unknown as PathMapping;
        for (const [path, docId] of Object.entries(old)) {
          this.mapping[path] = { docId, contentHash: '' };
        }
        console.log(`Dify Sync：已从旧格式迁移 ${keys.length} 条映射`);
        await this.saveMapping();
        return;
      }
    }

    // 新格式
    this.mapping = raw as unknown as PathMappingV2;

    // 加载上次同步时间
    if (typeof data.lastSyncTime === 'number') {
      this.lastSyncTime = data.lastSyncTime;
    }
  }

  async saveMapping(): Promise<void> {
    await this.plugin.saveData({ mapping: this.mapping, lastSyncTime: this.lastSyncTime });
  }

  /** 取出 docId，不存在返回 undefined */
  private docIdFor(path: string): string | undefined {
    return this.mapping[path]?.docId;
  }

  // ─── 冲突检测 ──────────────────────────────────────────────────

  /**
   * 检查 Dify 端文档是否被外部修改过。
   * 拉取 Dify 文档内容 → 计算 hash → 与本地记录比对。
   * @returns true=有冲突（Dify 端被修改过），false=无冲突或无法判断
   */
  private async checkDifyConflict(docId: string, localHash: string): Promise<boolean> {
    try {
      const detail = await this.getClient().getDocument(docId);
      if (!detail || detail.text === undefined) {
        // API 不返回文本内容 → 无法判断，保守处理：当作无冲突
        return false;
      }
      const difyHash = await this.hashContent(detail.text);
      return difyHash !== localHash;
    } catch {
      // 获取失败 → 无法判断，保守处理：当作无冲突
      return false;
    }
  }

  // ─── 作用域判断 ────────────────────────────────────────────────

  /** 读取文件的 frontmatter 标签列表 */
  private getFileTags(file: TFile): string[] {
    const cache = this.plugin.app.metadataCache.getFileCache(file);
    if (!cache) return [];
    const tags: string[] = [];
    // frontmatter tags
    if (cache.frontmatter?.tags) {
      const fmTags = cache.frontmatter.tags;
      if (Array.isArray(fmTags)) {
        for (const t of fmTags) {
          if (typeof t === 'string') tags.push(t.replace(/^#/, ''));
        }
      } else if (typeof fmTags === 'string') {
        tags.push(fmTags.replace(/^#/, ''));
      }
    }
    // inline tags (#tag in body)
    if (cache.tags) {
      for (const t of cache.tags) {
        const tag = t.tag.replace(/^#/, '');
        if (!tags.includes(tag)) tags.push(tag);
      }
    }
    return tags;
  }

  /** 综合判断：文件夹 + 标签过滤 */
  private shouldSync(file: TFile): boolean {
    const settings = this.plugin.settings;

    // 文件夹过滤
    const folder = settings.syncFolder;
    if (folder !== '/' && folder !== '') {
      const normalized = folder.endsWith('/') ? folder : folder + '/';
      if (!file.path.startsWith(normalized)) return false;
    }

    // 标签过滤
    const filterTags = settings.filterTags.trim();
    if (!filterTags) return true;

    const requiredTags = filterTags.split(',')
      .map(t => t.trim().replace(/^#/, ''))
      .filter(t => t.length > 0);

    if (requiredTags.length === 0) return true;

    const fileTags = this.getFileTags(file);
    return requiredTags.every(rt => fileTags.includes(rt));
  }

  // ─── 事件处理 ──────────────────────────────────────────────────

  /** 新建文件 → 在 Dify 中创建文档 */
  async onFileCreated(file: TFile): Promise<void> {
    if (this.syncing || !this.shouldSync(file)) return;
    if (this.mapping[file.path]) return;

    const settings = this.plugin.settings;
    if (!settings.endpoint || !settings.apiKey || !settings.datasetId) return;

    try {
      this.syncing = true;
      const content = await this.plugin.app.vault.read(file);
      const name = this.getDocName(file);
      const hash = await this.hashContent(content);

      const resp = await this.getClient().createDocument(name, content, settings.docLanguage);
      this.mapping[file.path] = { docId: resp.document.id, contentHash: hash };
      await this.saveMapping();

      new Notice(`Dify Sync：已创建「${name}」`);
    } catch (e) {
      console.error('Dify Sync：创建失败', file.path, e);
      new Notice(`Dify Sync：创建「${file.basename}」失败`);
    } finally {
      this.syncing = false;
    }
  }

  /** 文件修改 → 防抖 + 内容比对后才决定是否上传 */
  async onFileModified(file: TFile): Promise<void> {
    if (!this.shouldSync(file)) return;

    const entry = this.mapping[file.path];
    if (!entry) {
      // 还没建过映射 → 当新建处理（不防抖）
      await this.onFileCreated(file);
      return;
    }

    // ── 防抖：如果该文件已经在等待处理，取消旧的定时器 ──
    this.pendingModify.add(file.path);
    const existingTimer = this.debounceTimers.get(file.path);
    if (existingTimer !== undefined) {
      window.clearTimeout(existingTimer);
    }

    const timerId = window.setTimeout(async () => {
      this.debounceTimers.delete(file.path);
      this.pendingModify.delete(file.path);

      if (this.syncing) return;

      const settings = this.plugin.settings;
      if (!settings.endpoint || !settings.apiKey || !settings.datasetId) return;

      try {
        this.syncing = true;
        const content = await this.plugin.app.vault.read(file);
        const hash = await this.hashContent(content);

        // 内容没变 → 跳过
        if (hash === entry.contentHash) {
          console.log(`Dify Sync：跳过「${file.basename}」（内容未变化）`);
          return;
        }

        // ── 冲突检测（keep_dify 策略）──
        if (settings.conflictStrategy === 'keep_dify') {
          const conflict = await this.checkDifyConflict(entry.docId, entry.contentHash);
          if (conflict) {
            console.log(`Dify Sync：冲突跳过「${file.basename}」（Dify 端已被外部修改）`);
            new Notice(`Dify Sync：冲突跳过「${file.basename}」`);
            return;
          }
        }

        const name = this.getDocName(file);
        await this.getClient().updateDocument(entry.docId, name, content, settings.docLanguage);
        entry.contentHash = hash;
        await this.saveMapping();

        console.log(`Dify Sync：已更新「${name}」`);
      } catch (e) {
        console.error('Dify Sync：更新失败', file.path, e);
        new Notice(`Dify Sync：更新「${file.basename}」失败`);
      } finally {
        this.syncing = false;
      }
    }, MODIFY_DEBOUNCE_MS);

    this.debounceTimers.set(file.path, timerId);
  }

  /** 文件删除 → 删除 Dify 文档 */
  async onFileDeleted(file: TFile): Promise<void> {
    if (this.syncing || !this.shouldSync(file)) return;

    const docId = this.docIdFor(file.path);
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

    const oldEntry = this.mapping[oldPath];
    const settings = this.plugin.settings;
    const inScope = this.shouldSync(file);
    const wasInScope = (() => {
      const folder = settings.syncFolder;
      if (folder === '/' || folder === '') return true;
      const normalized = folder.endsWith('/') ? folder : folder + '/';
      return oldPath.startsWith(normalized);
    })();

    if (!settings.endpoint || !settings.apiKey || !settings.datasetId) return;

    try {
      this.syncing = true;

      if (oldEntry && wasInScope) {
        await this.getClient().deleteDocument(oldEntry.docId);
        delete this.mapping[oldPath];
      }

      if (inScope && file instanceof TFile) {
        const content = await this.plugin.app.vault.read(file);
        const name = this.getDocName(file);
        const hash = await this.hashContent(content);
        const resp = await this.getClient().createDocument(name, content, settings.docLanguage);
        this.mapping[file.path] = { docId: resp.document.id, contentHash: hash };
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

  // ─── 全量同步 ──────────────────────────────────────────────────

  /** 全量同步 */
  async fullSync(): Promise<void> {
    const settings = this.plugin.settings;
    if (!settings.endpoint || !settings.apiKey || !settings.datasetId) {
      new Notice('Dify Sync：请先配置 API 端点和 Key');
      return;
    }

    this.syncing = true;
    this.cancelFlag = false;
    const notice = new Notice('Dify Sync：正在全量同步…', 0);
    let created = 0;
    let updated = 0;
    let skipped = 0;
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

      // 双索引：路径名 + 旧版文件名（向后兼容）
      const difyByPath = new Map<string, string>();
      const difyByOldName = new Map<string, string>();
      const difyDocIds = new Set<string>();
      for (const d of difyDocs) {
        difyByPath.set(d.name, d.id);
        difyDocIds.add(d.id);
        if (!d.name.includes('/')) {
          difyByOldName.set(d.name, d.id);
        }
      }

      const files = this.plugin.app.vault.getMarkdownFiles()
        .filter(f => this.shouldSync(f));

      const obsidianPathNames = new Set<string>();
      const newMapping: PathMappingV2 = {};
      const total = files.length;

      // 为每个文件创建 task 工厂函数
      const tasks = files.map((file, index) => {
        const pathName = this.getDocName(file);
        obsidianPathNames.add(pathName);
        return async () => {
          // 匹配优先级：路径名 → 旧版文件名 → mapping ID（已验证）
          const existingEntry = this.mapping[file.path];
          const mappingDocId = existingEntry?.docId;
          const existingDocId = difyByPath.get(pathName)
            || difyByOldName.get(this.getOldDocName(file))
            || (mappingDocId && difyDocIds.has(mappingDocId) ? mappingDocId : undefined);

          const content = await this.plugin.app.vault.read(file);
          const hash = await this.hashContent(content);

          return {
            file,
            pathName,
            existingEntry,
            existingDocId,
            content,
            hash,
            index,
          };
        };
      });

      // 并发执行（计算阶段），非 I/O 不占并发——实际读文件已经在上面的 task 里了
      // 这里直接构建处理任务列表
      const processTasks: (() => Promise<{ action: 'skip' | 'update' | 'create'; file: TFile; pathName: string; docId?: string; hash: string }>)[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const pathName = this.getDocName(file);
        const existingEntry = this.mapping[file.path];
        const mappingDocId = existingEntry?.docId;
        const existingDocId = difyByPath.get(pathName)
          || difyByOldName.get(this.getOldDocName(file))
          || (mappingDocId && difyDocIds.has(mappingDocId) ? mappingDocId : undefined);

        processTasks.push(async () => {
          const content = await this.plugin.app.vault.read(file);
          const hash = await this.hashContent(content);

          if (existingDocId) {
            if (existingEntry && hash === existingEntry.contentHash) {
              return { action: 'skip' as const, file, pathName, docId: existingDocId, hash };
            }
            await this.getClient().updateDocument(existingDocId, pathName, content, settings.docLanguage);
            return { action: 'update' as const, file, pathName, docId: existingDocId, hash };
          } else {
            const resp = await this.getClient().createDocument(pathName, content, settings.docLanguage);
            return { action: 'create' as const, file, pathName, docId: resp.document.id, hash };
          }
        });
      }

      const poolResult = await this.runWithPool(processTasks, settings.maxConcurrency);

      // 处理结果
      for (const result of poolResult.results) {
        if (!result) continue;
        const { action, file, docId, hash } = result;
        if (action === 'skip') {
          newMapping[file.path] = this.mapping[file.path];
          skipped++;
        } else if (action === 'update') {
          newMapping[file.path] = { docId: docId!, contentHash: hash };
          updated++;
        } else {
          newMapping[file.path] = { docId: docId!, contentHash: hash };
          created++;
        }
      }

      // 进度更新
      const processed = created + updated + skipped;
      this.updateProgress(notice, poolResult.cancelled
        ? `已取消（完成 ${processed}/${total}）`
        : `全量同步完成 ${processed}/${total}`);

      if (poolResult.cancelled) {
        this.mapping = { ...this.mapping, ...newMapping };
        await this.saveMapping();
        notice.hide();
        new Notice(`Dify Sync：已取消（新增 ${created}，更新 ${updated}，跳过 ${skipped}）`);
        return;
      }

      // 清理 Dify 端多余文档
      for (const [name, docId] of difyByPath) {
        if (this.cancelFlag) break;
        if (!obsidianPathNames.has(name)) {
          try {
            await this.getClient().deleteDocument(docId);
            deleted++;
          } catch (e) {
            console.error('Dify Sync：清理多余文档失败', name, e);
          }
        }
      }

      this.mapping = newMapping;
      await this.saveMapping();

      notice.hide();
      new Notice(`Dify Sync：新增 ${created}，更新 ${updated}，跳过 ${skipped}，删除 ${deleted}`);
    } catch (e) {
      notice.hide();
      console.error('Dify Sync：全量同步失败', e);
      new Notice('Dify Sync：全量同步失败，详见控制台');
    } finally {
      this.syncing = false;
      this.cancelFlag = false;
      this.resetStatusBar();
    }
  }

  // ─── 增量同步 ──────────────────────────────────────────────────

  /** 增量同步：仅处理上次同步后修改过的文件 */
  async incrementalSync(): Promise<void> {
    const settings = this.plugin.settings;
    if (!settings.endpoint || !settings.apiKey || !settings.datasetId) {
      new Notice('Dify Sync：请先配置 API 端点和 Key');
      return;
    }

    this.syncing = true;
    this.cancelFlag = false;
    const notice = new Notice('Dify Sync：正在增量同步…', 0);
    let created = 0;
    let updated = 0;
    let skipped = 0;

    const syncStartTime = Date.now();

    try {
      const files = this.plugin.app.vault.getMarkdownFiles()
        .filter(f => this.shouldSync(f));

      // 按 mtime 过滤：只处理上次同步后修改过的文件
      const changed = files.filter(f => f.stat.mtime > this.lastSyncTime);

      if (changed.length === 0) {
        notice.hide();
        new Notice('Dify Sync：没有需要同步的文件');
        this.lastSyncTime = syncStartTime;
        await this.saveMapping();
        this.resetStatusBar();
        return;
      }

      const total = changed.length;

      const processTasks = changed.map((file) => {
        return async () => {
          const name = this.getDocName(file);
          const content = await this.plugin.app.vault.read(file);
          const hash = await this.hashContent(content);

          const existingEntry = this.mapping[file.path];

          if (existingEntry) {
            if (hash === existingEntry.contentHash) {
              return { action: 'skip' as const, file, name, hash };
            }

            if (settings.conflictStrategy === 'keep_dify') {
              const conflict = await this.checkDifyConflict(existingEntry.docId, existingEntry.contentHash);
              if (conflict) {
                console.log(`Dify Sync：冲突跳过「${name}」（Dify 端已被外部修改）`);
                return { action: 'skip' as const, file, name, hash };
              }
            }

            await this.getClient().updateDocument(
              existingEntry.docId, name, content, settings.docLanguage
            );
            return { action: 'update' as const, file, name, hash, docId: existingEntry.docId };
          } else {
            const resp = await this.getClient().createDocument(
              name, content, settings.docLanguage
            );
            return { action: 'create' as const, file, name, hash, docId: resp.document.id };
          }
        };
      });

      const poolResult = await this.runWithPool(processTasks, settings.maxConcurrency);

      for (const result of poolResult.results) {
        if (!result) continue;
        const { action, file, hash, docId } = result;
        if (action === 'skip') {
          skipped++;
        } else if (action === 'update') {
          const entry = this.mapping[file.path];
          if (entry) entry.contentHash = hash;
          updated++;
        } else {
          this.mapping[file.path] = { docId: docId!, contentHash: hash };
          created++;
        }
      }

      const processed = created + updated + skipped;
      this.updateProgress(notice, poolResult.cancelled
        ? `已取消（完成 ${processed}/${total}）`
        : `增量同步完成 ${processed}/${total}`);

      if (poolResult.cancelled) {
        this.lastSyncTime = syncStartTime;
        await this.saveMapping();
        notice.hide();
        new Notice(`Dify Sync：已取消（新增 ${created}，更新 ${updated}，跳过 ${skipped}）`);
        return;
      }

      this.lastSyncTime = syncStartTime;
      await this.saveMapping();

      notice.hide();
      new Notice(`Dify Sync：新增 ${created}，更新 ${updated}，跳过 ${skipped}`);
    } catch (e) {
      notice.hide();
      console.error('Dify Sync：增量同步失败', e);
      new Notice('Dify Sync：增量同步失败，详见控制台');
    } finally {
      this.syncing = false;
      this.cancelFlag = false;
      this.resetStatusBar();
    }
  }
}
