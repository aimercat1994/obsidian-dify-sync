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
}

export const DEFAULT_SETTINGS: DifySyncSettings = {
  endpoint: '',
  apiKey: '',
  datasetId: '',
  syncFolder: '/',
  autoSync: false,
  docLanguage: 'Chinese',
  conflictStrategy: 'overwrite',
};
