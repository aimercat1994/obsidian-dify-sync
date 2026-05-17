export interface DifySyncSettings {
  endpoint: string;
  apiKey: string;
  datasetId: string;
  syncFolder: string;
  autoSync: boolean;
  docLanguage: string;
}

export const DEFAULT_SETTINGS: DifySyncSettings = {
  endpoint: '',
  apiKey: '',
  datasetId: '',
  syncFolder: '/',
  autoSync: false,
  docLanguage: 'Chinese',
};
