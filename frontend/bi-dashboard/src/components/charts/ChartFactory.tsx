// frontend/bi-dashboard/src/components/charts/ChartFactory.tsx
import React from 'react';
import * as echarts from 'echarts';

interface ChartConfig {
  type: string;
  title?: string;
  xAxis?: any;
  yAxis?: any;
  series?: any[];
  xField?: string;
  yFields?: string[];
  colorField?: string;  // 添加颜色分组字段支持
}

interface ChartFactoryProps {
  config: ChartConfig;
  data: any[];
  style?: React.CSSProperties;
}

export const ChartFactory: React.FC<ChartFactoryProps> = ({ config, data, style }) => {
  const [chartInstance, setChartInstance] = React.useState<echarts.ECharts | null>(null);
  const chartRef = React.useRef<HTMLDivElement>(null);

  // 当数据或配置变化时更新图表
  React.useEffect(() => {
    if (!chartRef.current) return;

    // 初始化ECharts实例
    if (!chartInstance) {
      const instance = echarts.init(chartRef.current);
      setChartInstance(instance);
    }

    // 更新图表配置
    const option = generateChartOption(config, data);
    chartInstance?.setOption(option, true); // 添加true参数强制更新

    // 窗口大小变化时重绘图表
    const handleResize = () => {
      chartInstance?.resize();
    };
    window.addEventListener('resize', handleResize);

    // 清理函数
    return () => {
      window.removeEventListener('resize', handleResize);
      chartInstance?.dispose();
    };
  }, [config, data, chartInstance]);

  // 生成图表选项
  const generateChartOption = (config: ChartConfig, data: any[]) => {
    const option: any = {
      title: {
        text: config.title,
        left: 'center',
        textStyle: {
          fontSize: 16,
          fontWeight: 'normal'
        }
      },
      tooltip: {
        trigger: 'axis',
        formatter: function(params: any) {
          if (!params || params.length === 0) return '';
          
          let tooltip = `<strong>${params[0].name}</strong><br/>`;
          params.forEach((param: any) => {
            tooltip += `${param.seriesName}: ${param.value}<br/>`;
          });
          return tooltip;
        }
      },
      legend: {
        show: true,
        type: 'scroll',
        top: '10%',
        textStyle: {
          fontSize: 12
        }
      },
      grid: {
        left: '10%',
        right: '10%',
        bottom: '15%',
        containLabel: true
      }
    };

    // 定义颜色 palette
    const colorPalette = [
      '#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de', 
      '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc', '#5b8ff9',
      '#61ddaa', '#65789b', '#f6bd16', '#726fff', '#f19ec2'
    ];

    // 如果有colorField，处理颜色分组
    if (config.colorField && data.length > 0 && data[0][config.colorField]) {
      const uniqueValues = [...new Set(data.map(item => item[config.colorField!]))];
      option.color = uniqueValues.map((_, index) => colorPalette[index % colorPalette.length]);
    } else {
      option.color = colorPalette;
    }

    // 根据图表类型设置不同的配置
    switch (config.type) {
      case 'line':
        option.xAxis = {
          type: 'category',
          data: data.map((item: any) => item[config.xField || 'x']),
          axisLabel: {
            rotate: 45,
            fontSize: 12
          }
        };
        option.yAxis = {
          type: 'value',
          name: config.yAxis?.name,
          axisLabel: {
            fontSize: 12
          }
        };
        
        // 处理颜色分组
        if (config.colorField && config.yFields && config.yFields.length > 0) {
          const groupedData: Record<string, any[]> = {};
          data.forEach(item => {
            const groupKey = item[config.colorField!] || '未知';
            if (!groupedData[groupKey]) {
              groupedData[groupKey] = [];
            }
            groupedData[groupKey].push(item);
          });
          
          option.series = Object.entries(groupedData).flatMap(([group, groupData]) => 
            config.yFields!.map((field: string) => ({
              name: `${group} - ${field}`,
              type: 'line',
              smooth: true,
              data: groupData.map((item: any) => {
                const value = item[field];
                return value !== null && value !== undefined ? value : 0;
              }),
              symbolSize: 6,
              lineStyle: {
                width: 2
              }
            }))
          );
        } else {
          option.series = config.yFields?.map((field: string) => ({
            name: field,
            type: 'line',
            smooth: true,
            data: data.map((item: any) => {
              const value = item[field];
              return value !== null && value !== undefined ? value : 0;
            }),
            symbolSize: 6,
            lineStyle: {
              width: 2
            }
          })) || [];
        }
        break;

      case 'bar':
        option.xAxis = {
          type: 'category',
          data: data.map((item: any) => item[config.xField || 'x']),
          axisLabel: {
            rotate: 45,
            fontSize: 12
          }
        };
        option.yAxis = {
          type: 'value',
          name: config.yAxis?.name,
          axisLabel: {
            fontSize: 12
          }
        };
        
        // 处理颜色分组
        if (config.colorField && config.yFields && config.yFields.length > 0) {
          const groupedData: Record<string, any[]> = {};
          data.forEach(item => {
            const groupKey = item[config.colorField!] || '未知';
            if (!groupedData[groupKey]) {
              groupedData[groupKey] = [];
            }
            groupedData[groupKey].push(item);
          });
          
          option.series = Object.entries(groupedData).flatMap(([group, groupData]) => 
            config.yFields!.map((field: string) => ({
              name: `${group} - ${field}`,
              type: 'bar',
              data: groupData.map((item: any) => {
                const value = item[field];
                return value !== null && value !== undefined ? value : 0;
              }),
              barGap: '0%',
              barCategoryGap: '20%'
            }))
          );
        } else {
          option.series = config.yFields?.map((field: string) => ({
            name: field,
            type: 'bar',
            data: data.map((item: any) => {
              const value = item[field];
              return value !== null && value !== undefined ? value : 0;
            }),
            barGap: '0%',
            barCategoryGap: '20%'
          })) || [];
        }
        break;

      case 'area':
        option.xAxis = {
          type: 'category',
          data: data.map((item: any) => item[config.xField || 'x']),
          axisLabel: {
            rotate: 45,
            fontSize: 12
          }
        };
        option.yAxis = {
          type: 'value',
          name: config.yAxis?.name,
          axisLabel: {
            fontSize: 12
          }
        };
        
        // 处理颜色分组
        if (config.colorField && config.yFields && config.yFields.length > 0) {
          const groupedData: Record<string, any[]> = {};
          data.forEach(item => {
            const groupKey = item[config.colorField!] || '未知';
            if (!groupedData[groupKey]) {
              groupedData[groupKey] = [];
            }
            groupedData[groupKey].push(item);
          });
          
          option.series = Object.entries(groupedData).flatMap(([group, groupData]) => 
            config.yFields!.map((field: string) => ({
              name: `${group} - ${field}`,
              type: 'line',
              smooth: true,
              areaStyle: {
                opacity: 0.3
              },
              data: groupData.map((item: any) => {
                const value = item[field];
                return value !== null && value !== undefined ? value : 0;
              }),
              symbolSize: 0,
              lineStyle: {
                width: 2
              }
            }))
          );
        } else {
          option.series = config.yFields?.map((field: string) => ({
            name: field,
            type: 'line',
            smooth: true,
            areaStyle: {
              opacity: 0.3
            },
            data: data.map((item: any) => {
              const value = item[field];
              return value !== null && value !== undefined ? value : 0;
            }),
            symbolSize: 0,
            lineStyle: {
              width: 2
            }
          })) || [];
        }
        break;

      case 'pie':
        option.legend = {
          show: true,
          type: 'scroll',
          top: '10%',
          textStyle: {
            fontSize: 12
          }
        };
        
        // 饼图不支持colorField分组，直接按yFields显示
        if (config.yFields && config.yFields.length > 0) {
          const field = config.yFields[0];
          option.series = [{
            name: config.title || field,
            type: 'pie',
            radius: ['40%', '70%'],
            center: ['50%', '60%'],
            avoidLabelOverlap: false,
            label: {
              show: false,
              position: 'center'
            },
            emphasis: {
              label: {
                show: true,
                fontSize: '16',
                fontWeight: 'bold'
              }
            },
            labelLine: {
              show: false
            },
            data: data.map((item: any) => ({
              value: item[field] !== null && item[field] !== undefined ? item[field] : 0,
              name: item[config.xField || 'name'] || '未知'
            }))
          }];
        }
        break;

      case 'scatter':
        option.xAxis = {
          type: 'value',
          name: config.xAxis?.name || 'X轴',
          axisLabel: {
            fontSize: 12
          }
        };
        option.yAxis = {
          type: 'value',
          name: config.yAxis?.name || 'Y轴',
          axisLabel: {
            fontSize: 12
          }
        };
        
        // 散点图的颜色分组
        if (config.colorField && config.yFields && config.yFields.length > 0) {
          const field = config.yFields[0];
          const groupedData: Record<string, any[]> = {};
          data.forEach(item => {
            const groupKey = item[config.colorField!] || '未知';
            if (!groupedData[groupKey]) {
              groupedData[groupKey] = [];
            }
            groupedData[groupKey].push(item);
          });
          
          option.series = Object.entries(groupedData).map(([group, groupData]) => ({
            name: group,
            type: 'scatter',
            data: groupData.map((item: any) => [
              item[config.xField || 'x'],
              item[field]
            ]),
            symbolSize: 10
          }));
        } else if (config.yFields && config.yFields.length > 0) {
          const field = config.yFields[0];
          option.series = [{
            name: field,
            type: 'scatter',
            data: data.map((item: any) => [
              item[config.xField || 'x'],
              item[field]
            ]),
            symbolSize: 10
          }];
        }
        break;

      default:
        // 默认使用折线图
        option.xAxis = {
          type: 'category',
          data: data.map((item: any) => item[config.xField || 'x']),
          axisLabel: {
            rotate: 45,
            fontSize: 12
          }
        };
        option.yAxis = {
          type: 'value',
          name: config.yAxis?.name,
          axisLabel: {
            fontSize: 12
          }
        };
        option.series = [{
          name: config.title || '默认系列',
          type: 'line',
          data: data.map((item: any) => {
            const field = config.yFields?.[0] || 'y';
            const value = item[field];
            return value !== null && value !== undefined ? value : 0;
          }),
          symbolSize: 6,
          lineStyle: {
            width: 2
          }
        }];
    }

    return option;
  };

  return (
    <div ref={chartRef} style={{ ...style, height: '100%' }} />
  );
};