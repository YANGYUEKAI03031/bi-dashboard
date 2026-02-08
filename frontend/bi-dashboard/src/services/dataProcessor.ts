// src/services/dataProcessor.ts
// 临时定义 QueryResult 接口，避免循环依赖
export interface QueryResult {
  columns: string[];
  rows: any[][];
  rowCount: number;
  executionTime: number;
}

export interface FilterConfig {
  field: string;
  operator: 'equals' | 'not_equals' | 'greater_than' | 'less_than' | 'contains' | 'starts_with' | 'ends_with';
  value: any;
  logicalOperator?: 'AND' | 'OR';
}

export interface CalculatedColumn {
  name: string;
  formula: string;
  type: 'number' | 'string' | 'date';
}

export interface DataProcessingConfig {
  filters: FilterConfig[];
  calculatedColumns: CalculatedColumn[];
  sortBy?: { field: string; direction: 'asc' | 'desc' };
  limit?: number;
}

export class DataProcessor {
  static async processRawData(
    rawData: QueryResult, 
    config: DataProcessingConfig
  ): Promise<QueryResult> {
    let processedRows = [...rawData.rows];
    
    // 1. 应用筛选
    if (config.filters.length > 0) {
      processedRows = this.applyFilters(processedRows, rawData.columns, config.filters);
    }
    
    // 2. 添加计算列
    if (config.calculatedColumns.length > 0) {
      processedRows = this.addCalculatedColumns(processedRows, rawData.columns, config.calculatedColumns);
      // 更新列信息
      const newColumns = [...rawData.columns, ...config.calculatedColumns.map(col => col.name)];
      rawData.columns = newColumns;
    }
    
    // 3. 排序
    if (config.sortBy) {
      processedRows = this.sortData(processedRows, rawData.columns, config.sortBy);
    }
    
    // 4. 限制行数
    if (config.limit && config.limit > 0) {
      processedRows = processedRows.slice(0, config.limit);
    }
    
    return {
      ...rawData,
      rows: processedRows,
      rowCount: processedRows.length
    };
  }
  
  private static applyFilters(
    rows: any[][], 
    columns: string[], 
    filters: FilterConfig[]
  ): any[][] {
    return rows.filter(row => {
      return filters.every(filter => {
        const columnIndex = columns.indexOf(filter.field);
        if (columnIndex === -1) return true;
        
        const cellValue = row[columnIndex];
        return this.evaluateFilter(cellValue, filter);
      });
    });
  }
  
  private static evaluateFilter(value: any, filter: FilterConfig): boolean {
    switch (filter.operator) {
      case 'equals':
        return value == filter.value;
      case 'not_equals':
        return value != filter.value;
      case 'greater_than':
        return Number(value) > Number(filter.value);
      case 'less_than':
        return Number(value) < Number(filter.value);
      case 'contains':
        return String(value).toLowerCase().includes(String(filter.value).toLowerCase());
      default:
        return true;
    }
  }
  
  private static addCalculatedColumns(
    rows: any[][], 
    columns: string[], 
    calculatedColumns: CalculatedColumn[]
  ): any[][] {
    return rows.map(row => {
      const newRow = [...row];
      
      calculatedColumns.forEach(calcCol => {
        try {
          const calculatedValue = this.evaluateFormula(newRow, columns, calcCol.formula);
          newRow.push(calculatedValue);
        } catch (error) {
          console.warn(`计算列 "${calcCol.name}" 公式错误:`, error);
          newRow.push(null);
        }
      });
      
      return newRow;
    });
  }
  
  private static evaluateFormula(row: any[], columns: string[], formula: string): any {
    let processedFormula = formula;
    
    columns.forEach((colName, index) => {
      const regex = new RegExp(`\\b${colName}\\b`, 'g');
      processedFormula = processedFormula.replace(regex, `row[${index}]`);
    });
    
    try {
      return new Function('row', `return ${processedFormula}`)(row);
    } catch (error) {
      throw new Error(`公式解析失败: ${formula}`);
    }
  }
  
  private static sortData(
    rows: any[][], 
    columns: string[], 
    sortBy: { field: string; direction: 'asc' | 'desc' }
  ): any[][] {
    const columnIndex = columns.indexOf(sortBy.field);
    if (columnIndex === -1) return rows;
    
    return [...rows].sort((a, b) => {
      const aValue = a[columnIndex];
      const bValue = b[columnIndex];
      
      if (sortBy.direction === 'asc') {
        return aValue > bValue ? 1 : aValue < bValue ? -1 : 0;
      } else {
        return aValue < bValue ? 1 : aValue > bValue ? -1 : 0;
      }
    });
  }
}