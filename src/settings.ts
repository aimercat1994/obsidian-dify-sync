export type ConflictStrategy = 'overwrite' | 'keep_dify';

export interface DifySyncSettings {
  endpoint: string;
  apiKey: string;
  datasetId: string;
  syncFolder: string;
  autoSync: boolean;
  docLanguage: string;
  /** 冲突处理策略：overwrite=Obsidian 胜出，keep_dify=Dify 有修改时跳过 */
  conflictStrategy: ConflictStrategy;
  /** 按标签过滤：逗号分隔，留空=不过滤。如 "dify,public" */
  filterTags: string;
  /** 最大并发数：同时发往 Dify 的 API 请求数（1-10） */
  maxConcurrency: number;
}

export const DEFAULT_SETTINGS: DifySyncSettings = {
  endpoint: '',
  apiKey: '',
  datasetId: '',
  syncFolder: '/',
  autoSync: false,
  docLanguage: 'Chinese',
  conflictStrategy: 'overwrite',
  filterTags: '',
  maxConcurrency: 3,
};
