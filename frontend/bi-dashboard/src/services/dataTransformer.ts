// src/services/dataTransformer.ts
// 临时定义接口
interface QueryResult {
  columns: string[];
  rows: any[][];
  rowCount: number;
  executionTime: number;
}

interface ChartConfig {
  type: string;
  title: string;
  xAxis?: { field: string; title: string };
  yAxis?: { field: string; title: string };
  series: any[];
  dataBinding: any;
  styling: any;
}

export class DataTransformer {
  static transformForChart(result: QueryResult, config: ChartConfig): any {
    const { columns, rows } = result;
    
    switch (config.type) {
      case 'bar':
      case 'line':
      case 'area':
        return this.transformToXYData(columns, rows, config.series);
      
      case 'pie':
      case 'doughnut':
        return this.transformToPieData(columns, rows, config.series[0]);
      
      case 'scatter':
        return this.transformToScatterData(columns, rows, config.series[0]);
      
      case 'radar':
        return this.transformToRadarData(columns, rows, config.series);
      
      default:
        return { labels: [], datasets: [] };
    }
  }
  
  private static transformToXYData(
    columns: string[], 
    rows: any[][], 
    series: any[]
  ): any {
    const labels = rows.map(row => row[0]);
    
    const datasets = series.map((serie, index) => {
      const dataIndex = columns.indexOf(serie.dataField);
      return {
        label: serie.name,
        data: rows.map(row => row[dataIndex]),
        backgroundColor: serie.color || this.getColor(index),
        borderColor: serie.color || this.getColor(index),
        tension: 0.1
      };
    });
    
    return { labels, datasets };
  }
  
  private static transformToPieData(
    columns: string[], 
    rows: any[][], 
    series: any
  ): any {
    const labelIndex = 0;
    const dataIndex = columns.indexOf(series.dataField);
    
    const data = rows.map(row => ({
      label: row[labelIndex],
      value: row[dataIndex]
    }));
    
    return {
      labels: data.map(d => d.label),
      datasets: [{
        data: data.map(d => d.value),
        backgroundColor: this.generateColors(data.length)
      }]
    };
  }
  
  private static transformToScatterData(
    columns: string[], 
    rows: any[][], 
    series: any
  ): any {
    const xIndex = columns.indexOf('x') !== -1 ? columns.indexOf('x') : 0;
    const yIndex = columns.indexOf('y') !== -1 ? columns.indexOf('y') : 1;
    
    return {
      datasets: [{
        label: series.name,
        data: rows.map(row => ({
          x: row[xIndex],
          y: row[yIndex]
        })),
        backgroundColor: series.color || this.getColor(0)
      }]
    };
  }
  
  private static transformToRadarData(
    columns: string[], 
    rows: any[][], 
    series: any[]
  ): any {
    const labels = rows.map(row => row[0]);
    
    const datasets = series.map((serie, index) => {
      const dataIndex = columns.indexOf(serie.dataField);
      return {
        label: serie.name,
        data: rows.map(row => row[dataIndex]),
        backgroundColor: serie.color ? `${serie.color}40` : `${this.getColor(index)}40`,
        borderColor: serie.color || this.getColor(index),
        pointBackgroundColor: serie.color || this.getColor(index)
      };
    });
    
    return { labels, datasets };
  }
  
  private static getColor(index: number): string {
    const colors = [
      '#3b82f6', '#ef4444', '#10b981', '#f59e0b', 
      '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'
    ];
    return colors[index % colors.length];
  }
  
  private static generateColors(count: number): string[] {
    const colors = [];
    for (let i = 0; i < count; i++) {
      colors.push(this.getColor(i));
    }
    return colors;
  }
}