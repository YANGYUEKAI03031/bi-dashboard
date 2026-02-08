// src/services/dataProcessor.ts
export interface ProcessedData {
  id: string;
  fileName: string;
  originalData: any[];
  processedData: any[];
  columns: string[];
  createdAt: Date;
  operations: DataOperation[];
}

export interface DataOperation {
  id: string;
  type: 'filter' | 'sort' | 'calculate' | 'group' | 'transform';
  column: string;
  parameters: any;
  timestamp: Date;
}

// 新增：原始数据处理选项接口
export interface RawDataProcessingOptions {
  filters?: Array<{
    column: string;
    condition: string;
    value: any;
  }>;
  calculatedColumns?: Array<{
    name: string;
    formula: string;
  }>;
  sortBy?: {
    field: string;
    direction: 'asc' | 'desc';
  };
  limit?: number;
}

// 新增：原始数据格式接口
export interface RawData {
  columns: string[];
  rows: any[][];
  rowCount: number;
  executionTime: number;
}

export class DataProcessorService {
  private static instance: DataProcessorService;
  private processedDatasets: Map<string, ProcessedData> = new Map();

  static getInstance(): DataProcessorService {
    if (!DataProcessorService.instance) {
      DataProcessorService.instance = new DataProcessorService();
    }
    return DataProcessorService.instance;
  }

  // 新增：处理原始数据的方法
  async processRawData(rawData: RawData, options: RawDataProcessingOptions): Promise<ProcessedData> {
    try {
      // 将原始数据转换为对象数组格式
      const dataObjects = rawData.rows.map(row => {
        const obj: any = {};
        rawData.columns.forEach((col, index) => {
          obj[col] = row[index];
        });
        return obj;
      });

      // 创建临时处理数据集
      const tempDatasetId = this.generateId();
      const processedData: ProcessedData = {
        id: tempDatasetId,
        fileName: 'raw_query_data',
        originalData: dataObjects,
        processedData: [...dataObjects],
        columns: [...rawData.columns],
        createdAt: new Date(),
        operations: []
      };

      // 应用过滤器
      if (options.filters && options.filters.length > 0) {
        options.filters.forEach(filter => {
          processedData.processedData = processedData.processedData.filter(row => {
            const cellValue = row[filter.column];
            switch (filter.condition) {
              case 'equals': return cellValue == filter.value;
              case 'contains': return String(cellValue).includes(String(filter.value));
              case 'greater': return Number(cellValue) > Number(filter.value);
              case 'less': return Number(cellValue) < Number(filter.value);
              case 'not_equals': return cellValue != filter.value;
              default: return true;
            }
          });
        });
      }

      // 应用排序
      if (options.sortBy) {
        processedData.processedData.sort((a, b) => {
          const aVal = a[options.sortBy!.field];
          const bVal = b[options.sortBy!.field];
          
          if (options.sortBy!.direction === 'asc') {
            return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
          } else {
            return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
          }
        });
      }

      // 应用计算列
      if (options.calculatedColumns && options.calculatedColumns.length > 0) {
        options.calculatedColumns.forEach(calcCol => {
          processedData.processedData = processedData.processedData.map(row => {
            const newRow = { ...row };
            try {
              const evaluatedValue = this.evaluateFormula(calcCol.formula, row);
              newRow[calcCol.name] = evaluatedValue;
            } catch (error) {
              newRow[calcCol.name] = null;
            }
            return newRow;
          });
          
          // 更新列列表
          if (!processedData.columns.includes(calcCol.name)) {
            processedData.columns.push(calcCol.name);
          }
        });
      }

      // 应用限制
      if (options.limit && options.limit > 0) {
        processedData.processedData = processedData.processedData.slice(0, options.limit);
      }

      return processedData;
    } catch (error) {
      throw new Error(`处理原始数据失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  // Load data from file
  async loadDataFromFile(file: File): Promise<ProcessedData> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = (e) => {
        try {
          const data = this.parseFileData(e.target?.result as string, file.type);
          const processedData: ProcessedData = {
            id: this.generateId(),
            fileName: file.name,
            originalData: data,
            processedData: [...data],
            columns: Object.keys(data[0] || {}),
            createdAt: new Date(),
            operations: []
          };
          
          this.processedDatasets.set(processedData.id, processedData);
          resolve(processedData);
        } catch (error) {
          reject(error);
        }
      };
      
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  }

  private parseFileData(content: string, fileType: string): any[] {
    if (fileType.includes('csv')) {
      return this.parseCSV(content);
    } else if (fileType.includes('json')) {
      return JSON.parse(content);
    } else {
      throw new Error('Unsupported file type');
    }
  }

  private parseCSV(csv: string): any[] {
    const lines = csv.split('\n');
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const data = [];
    
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim()) {
        const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
        const row: any = {};
        headers.forEach((header, index) => {
          row[header] = this.parseValue(values[index]);
        });
        data.push(row);
      }
    }
    
    return data;
  }

  private parseValue(value: string): any {
    if (value === '' || value === 'null' || value === 'undefined') return null;
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
    if (!isNaN(Number(value))) return Number(value);
    return value;
  }

  // Filter data
  filterData(datasetId: string, column: string, condition: string, value: any): ProcessedData {
    const dataset = this.processedDatasets.get(datasetId);
    if (!dataset) throw new Error('Dataset not found');

    const filteredData = dataset.processedData.filter(row => {
      const cellValue = row[column];
      switch (condition) {
        case 'equals': return cellValue == value;
        case 'contains': return String(cellValue).includes(String(value));
        case 'greater': return Number(cellValue) > Number(value);
        case 'less': return Number(cellValue) < Number(value);
        case 'not_equals': return cellValue != value;
        default: return true;
      }
    });

    const newOperation: DataOperation = {
      id: this.generateId(),
      type: 'filter',
      column,
      parameters: { condition, value },
      timestamp: new Date()
    };

    const updatedDataset = {
      ...dataset,
      processedData: filteredData,
      operations: [...dataset.operations, newOperation]
    };

    this.processedDatasets.set(datasetId, updatedDataset);
    return updatedDataset;
  }

  // Sort data
  sortData(datasetId: string, column: string, direction: 'asc' | 'desc'): ProcessedData {
    const dataset = this.processedDatasets.get(datasetId);
    if (!dataset) throw new Error('Dataset not found');

    const sortedData = [...dataset.processedData].sort((a, b) => {
      const aVal = a[column];
      const bVal = b[column];
      
      if (direction === 'asc') {
        return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
      } else {
        return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
      }
    });

    const newOperation: DataOperation = {
      id: this.generateId(),
      type: 'sort',
      column,
      parameters: { direction },
      timestamp: new Date()
    };

    const updatedDataset = {
      ...dataset,
      processedData: sortedData,
      operations: [...dataset.operations, newOperation]
    };

    this.processedDatasets.set(datasetId, updatedDataset);
    return updatedDataset;
  }

  // Calculate new column
  calculateColumn(datasetId: string, newColumnName: string, formula: string): ProcessedData {
    const dataset = this.processedDatasets.get(datasetId);
    if (!dataset) throw new Error('Dataset not found');

    const calculatedData = dataset.processedData.map(row => {
      const newRow = { ...row };
      try {
        // Simple formula evaluation (you might want to use a safer eval library)
        const evaluatedValue = this.evaluateFormula(formula, row);
        newRow[newColumnName] = evaluatedValue;
      } catch (error) {
        newRow[newColumnName] = null;
      }
      return newRow;
    });

    // Update columns list
    const updatedColumns = [...dataset.columns];
    if (!updatedColumns.includes(newColumnName)) {
      updatedColumns.push(newColumnName);
    }

    const newOperation: DataOperation = {
      id: this.generateId(),
      type: 'calculate',
      column: newColumnName,
      parameters: { formula },
      timestamp: new Date()
    };

    const updatedDataset = {
      ...dataset,
      processedData: calculatedData,
      columns: updatedColumns,
      operations: [...dataset.operations, newOperation]
    };

    this.processedDatasets.set(datasetId, updatedDataset);
    return updatedDataset;
  }

  private evaluateFormula(formula: string, rowData: any): any {
    // Replace column names with actual values
    let processedFormula = formula;
    Object.keys(rowData).forEach(column => {
      const regex = new RegExp(`\\b${column}\\b`, 'g');
      processedFormula = processedFormula.replace(regex, rowData[column]);
    });
    
    // Simple math evaluation (for production, use a proper expression parser)
    try {
      return Function('"use strict"; return (' + processedFormula + ')')();
    } catch (error) {
      throw new Error('Invalid formula');
    }
  }

  // Group data
  groupData(datasetId: string, groupBy: string, aggregations: Record<string, string>): ProcessedData {
    const dataset = this.processedDatasets.get(datasetId);
    if (!dataset) throw new Error('Dataset not found');

    const grouped: Record<string, any[]> = {};
    dataset.processedData.forEach(row => {
      const key = String(row[groupBy]);
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(row);
    });

    const aggregatedData = Object.entries(grouped).map(([key, rows]) => {
      const result: any = { [groupBy]: key };
      
      Object.entries(aggregations).forEach(([column, operation]) => {
        const values = rows.map(row => row[column]).filter(v => v !== null && v !== undefined);
        
        switch (operation) {
          case 'sum':
            result[`${column}_sum`] = values.reduce((sum, val) => sum + Number(val), 0);
            break;
          case 'avg':
            result[`${column}_avg`] = values.length > 0 ? values.reduce((sum, val) => sum + Number(val), 0) / values.length : 0;
            break;
          case 'count':
            result[`${column}_count`] = values.length;
            break;
          case 'min':
            result[`${column}_min`] = values.length > 0 ? Math.min(...values.map(Number)) : null;
            break;
          case 'max':
            result[`${column}_max`] = values.length > 0 ? Math.max(...values.map(Number)) : null;
            break;
        }
      });
      
      return result;
    });

    const newOperation: DataOperation = {
      id: this.generateId(),
      type: 'group',
      column: groupBy,
      parameters: { aggregations },
      timestamp: new Date()
    };

    const updatedDataset = {
      ...dataset,
      processedData: aggregatedData,
      operations: [...dataset.operations, newOperation]
    };

    this.processedDatasets.set(datasetId, updatedDataset);
    return updatedDataset;
  }

  // Save processed data
  async saveProcessedData(datasetId: string): Promise<string> {
    const dataset = this.processedDatasets.get(datasetId);
    if (!dataset) throw new Error('Dataset not found');

    const dataToSave = {
      metadata: {
        id: dataset.id,
        fileName: dataset.fileName,
        createdAt: dataset.createdAt,
        operations: dataset.operations
      },
      data: dataset.processedData
    };

    const blob = new Blob([JSON.stringify(dataToSave, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    // In a real app, you'd send this to your backend
    return url;
  }

  // Get dataset
  getDataset(datasetId: string): ProcessedData | undefined {
    return this.processedDatasets.get(datasetId);
  }

  // Get all datasets
  getAllDatasets(): ProcessedData[] {
    return Array.from(this.processedDatasets.values());
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
}