import React, { useMemo, useState, useRef, useEffect } from 'react';
import * as echarts from 'echarts/core';
import {
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  HeatmapChart,
  RadarChart,
  FunnelChart,
  GaugeChart,
  BoxplotChart,
  GraphChart,
  TreeChart,
  TreemapChart,
  SunburstChart,
  SankeyChart,
  ThemeRiverChart,
  // Removed CalendarChart import as it's not available
  EffectScatterChart,
  LinesChart,
  PictorialBarChart,
  ThemeRiverChart as ThemeRiver,
  CustomChart
} from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  ToolboxComponent,
  DataZoomComponent,
  VisualMapComponent,
  TimelineComponent,
  CalendarComponent, // Keep CalendarComponent for calendar coordinate system
  GraphicComponent,
  MarkLineComponent,
  MarkPointComponent,
  MarkAreaComponent
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import ReactECharts from 'echarts-for-react';

// 注册必需的组件
echarts.use([
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  HeatmapChart,
  RadarChart,
  FunnelChart,
  GaugeChart,
  BoxplotChart,
  GraphChart,
  TreeChart,
  TreemapChart,
  SunburstChart,
  SankeyChart,
  ThemeRiverChart,
  // Removed CalendarChart registration
  EffectScatterChart,
  LinesChart,
  PictorialBarChart,
  ThemeRiver,
  CustomChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  ToolboxComponent,
  DataZoomComponent,
  VisualMapComponent,
  TimelineComponent,
  CalendarComponent, // Keep CalendarComponent for calendar coordinate system
  GraphicComponent,
  MarkLineComponent,
  MarkPointComponent,
  MarkAreaComponent,
  CanvasRenderer
]);

interface ChartConfig {
  type: string;
  title?: string;
  xAxis?: any;
  yAxis?: any;
  series: any[];
  legend?: any;
  tooltip?: any;
  grid?: any;
  xField?: string; // X轴字段
  yFields?: string[]; // Y轴字段数组
  colorField?: string; // 颜色分组字段
  sort_by?: 'x' | 'y'; // 排序方式: 'x' 或 'y'
  sort_order?: 'asc' | 'desc'; // 排序顺序: 'asc' 或 'desc'
}

interface ChartFactoryProps {
  config: ChartConfig;
  data: any[];
  style?: React.CSSProperties;
  onEvents?: Record<string, Function>;
}

export const ChartFactory: React.FC<ChartFactoryProps> = ({
  config,
  data,
  style = { height: '400px' },
  onEvents
}) => {
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  
  // 监听容器大小变化
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setContainerSize({ width: rect.width, height: rect.height });
      }
    };
    
    updateSize();
    const resizeObserver = new ResizeObserver(updateSize);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }
    
    return () => {
      if (containerRef.current) {
        resizeObserver.unobserve(containerRef.current);
      }
    };
  }, []);
  
  const option = useMemo(() => {
    // 处理xAxis数据 - 使用配置的xField
    const xField = config.xField || (Object.keys(data[0] || {})[0]) || '';
    
    // 排序处理
    let sortedData = [...data];
    console.log('=== 排序处理开始 ===');
    console.log('原始数据:', data);
    console.log('配置信息:', { sort_by: config.sort_by, sort_order: config.sort_order, xField: xField });
    
    if (config.sort_by && config.sort_order) {
      console.log('开始执行排序逻辑');
      if (config.sort_by === 'x') {
        // 按X轴字段排序
        console.log('按X轴排序:', xField);
        sortedData.sort((a, b) => {
          const valA = a[xField];
          const valB = b[xField];
          console.log('比较值:', { valA, valB });
          
          if (typeof valA === 'number' && typeof valB === 'number') {
            const result = config.sort_order === 'asc' ? valA - valB : valB - valA;
            console.log('数字排序结果:', result);
            return result;
          }
          
          const result = config.sort_order === 'asc' 
            ? String(valA).localeCompare(String(valB)) 
            : String(valB).localeCompare(String(valA));
          console.log('字符串排序结果:', result);
          return result;
        });
      } else if (config.sort_by === 'y' && config.yFields && config.yFields.length > 0) {
        // 按第一个Y轴字段排序
        const yField = config.yFields[0];
        console.log('按Y轴排序:', yField);
        sortedData.sort((a, b) => {
          const valA = a[yField];
          const valB = b[yField];
          console.log('比较值:', { valA, valB });
          
          if (typeof valA === 'number' && typeof valB === 'number') {
            const result = config.sort_order === 'asc' ? valA - valB : valB - valA;
            console.log('数字排序结果:', result);
            return result;
          }
          
          const result = config.sort_order === 'asc' 
            ? String(valA).localeCompare(String(valB)) 
            : String(valB).localeCompare(String(valA));
          console.log('字符串排序结果:', result);
          return result;
        });
      }
      console.log('排序后数据:', sortedData);
    } else {
      console.log('跳过排序 - 缺少必要配置');
    }
    
    const xAxisData = sortedData.map(item => {
      if (!item) return '';
      
      // 支持多种数据格式
      if (typeof item === 'object' && item !== null) {
        // 对象格式：直接访问字段
        if (xField in item) {
          const value = item[xField];
          // 如果是日期格式，保持原样；否则转为字符串
          if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
            return value;
          }
          return String(value);
        }
        // 嵌套对象：尝试访问子属性
        if (xField.includes('.')) {
          const keys = xField.split('.');
          let value = item;
          for (const key of keys) {
            if (value && typeof value === 'object' && key in value) {
              value = value[key];
            } else {
              break;
            }
          }
          if (value !== undefined) {
            if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
              return value;
            }
            return String(value);
          }
        }
        // 数组格式：取第一个元素
        if (Array.isArray(item) && item.length > 0) {
          const firstValue = item[0];
          if (typeof firstValue === 'string' && /^\d{4}-\d{2}-\d{2}/.test(firstValue)) {
            return firstValue;
          }
          return String(firstValue);
        }
      }
      
      // 基本类型
      return String(item);
    });

    // 处理系列数据 - 使用配置的yFields
    let yFields = config.yFields || config.series.map(s => s.field) || [];

    // 如果yFields为空且有数据，尝试自动检测数值字段
    if (yFields.length === 0 && data.length > 0 && data[0]) {
      const firstItem = data[0];
      if (typeof firstItem === 'object') {
        // 检测数值字段
        const numericFields = Object.keys(firstItem).filter(key => {
          const value = firstItem[key];
          return typeof value === 'number' || 
                 (typeof value === 'string' && /^-?\d+\.?\d*$/.test(value));
        });
        
        if (numericFields.length > 0) {
          console.log('自动检测到数值字段:', numericFields);
          yFields = numericFields; // 使用所有检测到的数值字段
        }
      }
    }
    
    const baseOption: any = {
      title: {
        text: config.title || '',
        left: 'center'
      },
      tooltip: config.tooltip || {
        trigger: 'axis',
        axisPointer: {
          type: 'cross'
        }
      },
      legend: config.legend || {
        data: yFields.map(field => field),
        bottom: 10
      },
      grid: config.grid || {
        left: containerSize.width > 800 ? '5%' : '10%',
        right: containerSize.width > 800 ? '5%' : '10%',
        bottom: containerSize.height > 400 ? '20%' : '25%',
        top: containerSize.height > 400 ? '10%' : '15%',
        containLabel: true
      },
      xAxis: {
        ...config.xAxis,
        type: 'category',
        data: xAxisData,
        name: config.xAxis?.name || 'X轴',
        // 对于日期数据，添加时间轴格式化
        axisLabel: {
          formatter: function(value) {
            // 如果是日期格式，保持原样
            if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
              return value;
            }
            // 对于长文本，进行截断或换行
            if (typeof value === 'string' && value.length > 10) {
              return value.substring(0, 8) + '...';
            }
            return value;
          },
          rotate: containerSize.width < 600 ? 45 : 0,
          margin: 15
        }
      },
      yAxis: {
        ...config.yAxis,
        type: 'value',
        name: config.yAxis?.name || 'Y轴'
      }
    };

    // 根据图表类型调整配置
    switch (config.type.toLowerCase()) {
      case 'bar':
        baseOption.series = yFields.map(field => ({
          name: field,
          type: 'bar',
          data: sortedData.map(item => item[field] || 0),
          ...(config.colorField ? {
            encode: { x: config.xField, y: field }
          } : {})
        }));
        break;
        
      case 'line':
        baseOption.series = yFields.map(field => ({
          name: field,
          type: 'line',
          data: sortedData.map(item => item[field] || 0),
          smooth: true,
          ...(config.colorField ? {
            encode: { x: config.xField, y: field }
          } : {})
        }));
        break;
        
      case 'area':
        baseOption.series = yFields.map(field => ({
          name: field,
          type: 'line',
          data: sortedData.map(item => item[field] || 0),
          smooth: true,
          areaStyle: {},
          ...(config.colorField ? {
            encode: { x: config.xField, y: field }
          } : {})
        }));
        break;
        
      case 'pie':
        baseOption.tooltip = {
          trigger: 'item'
        };
        baseOption.legend = {
          top: 'bottom'
        };
        delete baseOption.xAxis;
        delete baseOption.yAxis;
        
        if (yFields.length > 0) {
          const fieldValue = yFields[0]; // 饼图通常只需要一个数值字段
          baseOption.series = [{
            type: 'pie',
            radius: ['40%', '70%'],
            data: sortedData.map((item, index) => ({
              name: item[xField] || `数据${index + 1}`,
              value: item[fieldValue] || 0
            })),
            emphasis: {
              itemStyle: {
                shadowBlur: 10,
                shadowOffsetX: 0,
                shadowColor: 'rgba(0, 0, 0, 0.5)'
              }
            }
          }];
        }
        break;
        
      case 'scatter':
        baseOption.xAxis.type = 'value';
        baseOption.yAxis.type = 'value';
        if (yFields.length >= 2) {
          baseOption.series = [{
            name: '散点图',
            type: 'scatter',
            data: sortedData.map(item => [item[yFields[0]] || 0, item[yFields[1]] || 0]),
            symbolSize: 10
          }];
          // 移除不必要的轴配置
          delete baseOption.xAxis.data;
          delete baseOption.xAxis.name;
          delete baseOption.yAxis.name;
        }
        break;
        
      case 'radar':
        // 雷达图配置
        const indicator = yFields.map(field => ({
          name: field,
          max: Math.max(...data.map(item => item[field] || 0)) * 1.1
        }));
        
        baseOption.radar = {
          indicator: indicator,
          shape: 'polygon',
          splitNumber: 5,
          axisName: {
            color: '#fff',
            backgroundColor: '#999',
            borderRadius: 3,
            padding: [3, 5]
          }
        };
        
        baseOption.series = [{
          type: 'radar',
          data: [{
            value: yFields.map(field => data[0]?.[field] || 0),
            name: '数据'
          }]
        }];
        
        // 删除坐标轴配置
        delete baseOption.xAxis;
        delete baseOption.yAxis;
        break;
        
      case 'boxplot':
        // 箱线图需要特殊的数据格式
        baseOption.series = [{
          name: '箱线图',
          type: 'boxplot',
          data: sortedData.map((item, index) => {
            // 箱线图需要5个值：[min, Q1, median, Q3, max]
            const values = yFields.map(field => item[field] || 0).sort((a, b) => a - b);
            if (values.length >= 5) {
              return values.slice(0, 5);
            } else {
              // 如果数据不足5个，补充数据
              const median = values[Math.floor(values.length / 2)] || 0;
              const q1 = values[Math.floor(values.length / 4)] || median;
              const q3 = values[Math.floor(values.length * 3 / 4)] || median;
              const min = Math.min(...values) || 0;
              const max = Math.max(...values) || 0;
              return [min, q1, median, q3, max];
            }
          })
        }];
        
        baseOption.xAxis = {
          type: 'category',
          data: data.map((_, index) => `组${index + 1}`)
        };
        
        baseOption.yAxis = {
          type: 'value'
        };
        break;
        
      case 'stacked_bar':
        // 堆积柱形图
        baseOption.series = yFields.map((field, index) => ({
          name: field,
          type: 'bar',
          stack: '总量',
          data: sortedData.map(item => item[field] || 0)
        }));
        break;
        
      case 'waterfall':
        // 瀑布图 - 需要计算累积值
        let cumulative = 0;
        const waterfallData = sortedData.map((item, index) => {
          const value = item[yFields[0]] || 0;
          const result = cumulative + value;
          cumulative = result;
          return {
            name: item[xField] || `项目${index + 1}`,
            value: value,
            cumulative: result
          };
        });
        
        baseOption.series = [{
          name: '瀑布图',
          type: 'bar',
          data: waterfallData.map(item => ({
            value: item.value,
            itemStyle: {
              color: item.value >= 0 ? '#5470c6' : '#ee6666'
            }
          }))
        }];
        
        // 添加辅助线显示累计值
        baseOption.series.push({
          name: '累计值',
          type: 'line',
          data: waterfallData.map(item => item.cumulative),
          symbol: 'none',
          lineStyle: {
            type: 'dashed'
          }
        });
        break;
        
      case 'funnel':
        // 漏斗图
        baseOption.series = [{
          name: '漏斗图',
          type: 'funnel',
          left: '10%',
          top: 60,
          bottom: 60,
          width: '80%',
          min: 0,
          max: 100,
          minSize: '0%',
          maxSize: '100%',
          sort: 'descending',
          gap: 2,
          label: {
            show: true,
            position: 'inside'
          },
          labelLine: {
            length: 10,
            lineStyle: {
              width: 1,
              type: 'solid'
            }
          },
          itemStyle: {
            borderColor: '#fff',
            borderWidth: 1
          },
          emphasis: {
            label: {
              fontSize: 20
            }
          },
          data: sortedData.map((item, index) => ({
            name: item[xField] || `阶段${index + 1}`,
            value: item[yFields[0]] || 0
          }))
        }];
        
        // 删除坐标轴配置
        delete baseOption.xAxis;
        delete baseOption.yAxis;
        break;
        
      case 'heatmap':
        // 热力图需要特殊的二维数据格式
        baseOption.visualMap = {
          min: 0,
          max: Math.max(...data.map(item => Math.max(...yFields.map(field => item[field] || 0)))),
          calculable: true,
          orient: 'horizontal',
          left: 'center',
          bottom: '15%'
        };
        baseOption.series = [{
          name: '热力图',
          type: 'heatmap',
          data: sortedData.map((item, rowIndex) => 
            yFields.map((field, colIndex) => [colIndex, rowIndex, item[field] || 0])
          ).flat(),
          label: {
            show: true
          },
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowColor: 'rgba(0, 0, 0, 0.5)'
            }
          }
        }];
        baseOption.xAxis = {
          type: 'category',
          data: yFields
        };
        baseOption.yAxis = {
          type: 'category',
          data: xAxisData
        };
        break;
        
      default:
        // 默认使用柱状图
        baseOption.series = yFields.map(field => ({
          name: field,
          type: 'bar',
          data: sortedData.map(item => item[field] || 0)
        }));
    }

    // 如果有颜色分组字段，添加颜色映射
    if (config.colorField && config.colorField !== '') {
      baseOption.visualMap = {
        show: false,
        dimension: 2,
        pieces: [
          { gt: 0, color: '#5470c6' },
          { gt: 100, color: '#91cc75' },
          { gt: 200, color: '#fac858' },
          { gt: 300, color: '#ee6666' },
          { gt: 400, color: '#73c0de' }
        ]
      };
    }

    return baseOption;
  }, [config, data]);

  // 添加调试信息
  console.log('ChartFactory props:', { config, data });
  console.log('排序配置检查:', { 
    sort_by: config.sort_by, 
    sort_order: config.sort_order,
    hasSortConfig: !!(config.sort_by && config.sort_order)
  });
  console.log('Generated option:', option);

  return (
    <div ref={containerRef} style={{ width: '100%', ...style }}>
      <ReactECharts
        option={option}
        notMerge={true}
        lazyUpdate={true}
        style={{ height: '100%' }}
        onEvents={onEvents}
      />
    </div>
  );
};