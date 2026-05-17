import { requestUrl, RequestUrlResponse } from 'obsidian';

export interface DifyDocument {
  id: string;
  name: string;
  indexing_status: string;
  display_status: string;
  created_at: number;
  tokens: number;
}

export interface DifyListResponse {
  data: DifyDocument[];
  has_more: boolean;
  limit: number;
  total: number;
  page: number;
}

export interface DifyCreateResponse {
  document: DifyDocument;
  batch: string;
}

export interface DifyUpdateResponse {
  document: DifyDocument;
  batch: string;
}

export interface DifyDocumentDetail {
  id: string;
  name: string;
  text: string;
  indexing_status: string;
  display_status: string;
  created_at: number;
  updated_at: number;
  tokens: number;
  word_count: number;
}

export class DifyClient {
  private endpoint: string;
  private apiKey: string;
  private datasetId: string;

  constructor(endpoint: string, apiKey: string, datasetId: string) {
    this.endpoint = endpoint;
    this.apiKey = apiKey;
    this.datasetId = datasetId;
  }

  private headers(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  /** List all documents (handles pagination) */
  async listAllDocuments(): Promise<DifyDocument[]> {
    const allDocs: DifyDocument[] = [];
    let page = 1;
    const limit = 100;

    while (true) {
      const url = `${this.endpoint}/datasets/${this.datasetId}/documents?page=${page}&limit=${limit}`;
      const resp: RequestUrlResponse = await requestUrl({
        url,
        method: 'GET',
        headers: this.headers(),
      });

      if (resp.status !== 200) {
        throw new Error(`Failed to list documents: ${resp.status} ${resp.text}`);
      }

      const body: DifyListResponse = resp.json;
      allDocs.push(...body.data);

      if (!body.has_more) break;
      page++;
    }

    return allDocs;
  }

  /** Get a single document's full detail (including text content) */
  async getDocument(documentId: string): Promise<DifyDocumentDetail | null> {
    const url = `${this.endpoint}/datasets/${this.datasetId}/documents/${documentId}`;
    const resp: RequestUrlResponse = await requestUrl({
      url,
      method: 'GET',
      headers: this.headers(),
    });

    if (resp.status !== 200) {
      console.warn(`Dify Sync：获取文档详情失败 ${resp.status}: ${resp.text}`);
      return null;
    }

    return resp.json as DifyDocumentDetail;
  }

  /** Create a document from text content */
  async createDocument(name: string, text: string, language: string): Promise<DifyCreateResponse> {
    const url = `${this.endpoint}/datasets/${this.datasetId}/document/create-by-text`;

    const resp: RequestUrlResponse = await requestUrl({
      url,
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        name,
        text,
        indexing_technique: 'high_quality',
        doc_form: 'text_model',
        doc_language: language,
      }),
    });

    if (resp.status !== 200 && resp.status !== 201) {
      throw new Error(`Failed to create document: ${resp.status} ${resp.text}`);
    }

    return resp.json;
  }

  /** Update document text content */
  async updateDocument(docId: string, name: string, text: string, language: string): Promise<DifyUpdateResponse> {
    const url = `${this.endpoint}/datasets/${this.datasetId}/documents/${docId}/update-by-text`;

    const resp: RequestUrlResponse = await requestUrl({
      url,
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        name,
        text,
        doc_form: 'text_model',
        doc_language: language,
      }),
    });

    if (resp.status !== 200) {
      throw new Error(`Failed to update document: ${resp.status} ${resp.text}`);
    }

    return resp.json;
  }

  /** Delete a document permanently */
  async deleteDocument(docId: string): Promise<void> {
    const url = `${this.endpoint}/datasets/${this.datasetId}/documents/${docId}`;

    const resp: RequestUrlResponse = await requestUrl({
      url,
      method: 'DELETE',
      headers: this.headers(),
    });

    if (resp.status !== 200 && resp.status !== 204) {
      throw new Error(`Failed to delete document: ${resp.status} ${resp.text}`);
    }
  }

  /** Check connection by listing documents (lightweight) */
  async testConnection(): Promise<boolean> {
    try {
      const url = `${this.endpoint}/datasets/${this.datasetId}/documents?page=1&limit=1`;
      const resp = await requestUrl({
        url,
        method: 'GET',
        headers: this.headers(),
      });
      return resp.status === 200;
    } catch {
      return false;
    }
  }
}
