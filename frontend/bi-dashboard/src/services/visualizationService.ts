
// 新建文件：src/services/visualizationService.ts
import axios from 'axios';
import { ChartConfig } from './chartService';

export interface VisualizationCard {
  id: number;
  name: string;
  description?: string;
  chartType: string;
  config: ChartConfig;
  dataSourceId: number;
  querySql: string;
  cacheEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DataSource {
  id: number;
  name: string;
  type: string;
  isActive: boolean;
}

class VisualizationService {
  private baseUrl = '/api/v1/visualizations';

  async getCards(): Promise<VisualizationCard[]> {
    const response = await axios.get(`${this.baseUrl}/cards`);
    return response.data;
  }

  async getCardData(cardId: number): Promise<any> {
    const response = await axios.get(`${this.baseUrl}/cards/${cardId}/data`);
    return response.data;
  }

  async createCard(cardData: Partial<VisualizationCard>): Promise<VisualizationCard> {
    const response = await axios.post(`${this.baseUrl}/cards`, cardData);
    return response.data;
  }

  async updateCard(cardId: number, cardData: Partial<VisualizationCard>): Promise<VisualizationCard> {
    const response = await axios.put(`${this.baseUrl}/cards/${cardId}`, cardData);
    return response.data;
  }

  async deleteCard(cardId: number): Promise<void> {
    await axios.delete(`${this.baseUrl}/cards/${cardId}`);
  }

  async getDataSources(): Promise<DataSource[]> {
    const response = await axios.get(`${this.baseUrl}/data-sources`);
    return response.data;
  }

  async getTableSchema(dataSourceId: number, tableName: string): Promise<any> {
    const response = await axios.get(
      `${this.baseUrl}/data-sources/${dataSourceId}/schema/${tableName}`
    );
    return response.data;
  }
}

export const visualizationService = new VisualizationService();