import React, { useState, useEffect, useRef } from 'react';
import { DataProcessorService, ProcessedData } from '../../services/dataProcessor';
import './AdvancedDataAnalyzer.css';

// 定义数据集接口
interface Dataset {
  id: string;
  name: string;
  data: any[];
  columns: string[];
  source: string;
  createdAt: Date;
}

// 定义数据操作接口
interface DataOperation {
  id: string;
  type: 'filter' | 'sort' | 'group' | 'calculate' | 'join' | 'pivot' | 'load' | 'manual_edit';
  config: any;
  timestamp: Date;
}

// 定义Python执行结果接口
interface PythonExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  data?: any;
}

// Helper function to convert ProcessedData to Dataset
const convertProcessedDataToDataset = (processedData: ProcessedData): Dataset => {
  return {
    id: processedData.id,
    name: processedData.fileName,
    data: processedData.processedData,
    columns: processedData.columns,
    source: 'uploaded_file',
    createdAt: processedData.createdAt
  };
};

// 数据集接口（匹配后端返回格式）
interface APIDataset {
  id: string;
  name: string;
  table_name: string;
  columns: string[];
  row_count: number;
  created_at: string;
}

export const AdvancedDataAnalyzer: React.FC = () => {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDataset, setSelectedDataset] = useState<string>('');
  const [operations, setOperations] = useState<DataOperation[]>([]);
  const [activeTab, setActiveTab] = useState<'data' | 'operations' | 'python' | 'visualize'>('data');
  const [pythonCode, setPythonCode] = useState<string>('// 在这里编写Python代码\nimport pandas as pd\nimport numpy as np\n\n# 示例：数据处理\ndf = pd.DataFrame(data)\nresult = df.describe()\nresult.to_dict()');
  const [pythonResult, setPythonResult] = useState<PythonExecutionResult | null>(null);
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  
  // Excel-like功能状态
  const [selectedCells, setSelectedCells] = useState<string[]>([]);
  const [editingCell, setEditingCell] = useState<{ row: number; col: string } | null>(null);
  const [cellEditValue, setCellEditValue] = useState<string>('');

  const editorRef = useRef<HTMLTextAreaElement>(null);
  const processor = DataProcessorService.getInstance();

  // 获取数据集列表
  const fetchDatasets = async () => {
    try {
      console.log('正在获取数据集列表...');
      const response = await fetch('http://localhost:8000/api/v1/data-analyzer/datasets');
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('API错误响应:', errorText);
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const textResponse = await response.text();
        console.error('非JSON响应:', textResponse);
        throw new Error('服务器返回了非JSON格式的响应');
      }
      
      const result = await response.json();
      const apiDatasets: APIDataset[] = result.datasets || [];
      console.log('接收到数据集:', apiDatasets);
      
      // 转换为组件需要的格式
      const convertedDatasets = apiDatasets.map(apiDataset => ({
        id: apiDataset.id,
        name: apiDataset.name,
        data: [], // 数据将在选择时加载
        columns: apiDataset.columns,
        source: 'mysql',
        createdAt: new Date(apiDataset.created_at)
      }));
      
      setDatasets(convertedDatasets);
      
      // 如果有数据集，选择第一个
      if (convertedDatasets.length > 0 && !selectedDataset) {
        setSelectedDataset(convertedDatasets[0].id);
      }
    } catch (error) {
      console.error('获取数据集失败:', error);
      
      // 显示友好错误信息
      let errorMessage = '获取数据集失败';
      if (error instanceof Error) {
        if (error.message.includes('Failed to fetch')) {
          errorMessage += ': 无法连接到服务器';
        } else if (error.message.includes('non-JSON')) {
          errorMessage += ': 服务器返回格式错误';
        } else {
          errorMessage += ': ' + error.message;
        }
      }
      
      alert(errorMessage);
      
      // 添加示例数据用于测试
      const sampleDatasets: Dataset[] = [
        {
          id: 'sample_users',
          name: '用户数据示例',
          data: [
            { id: 1, name: '张三', email: 'zhangsan@example.com', age: 25, city: '北京' },
            { id: 2, name: '李四', email: 'lisi@example.com', age: 30, city: '上海' },
            { id: 3, name: '王五', email: 'wangwu@example.com', age: 28, city: '广州' }
          ],
          columns: ['id', 'name', 'email', 'age', 'city'],
          source: 'sample',
          createdAt: new Date()
        }
      ];
      
      setDatasets(sampleDatasets);
      if (sampleDatasets.length > 0) {
        setSelectedDataset(sampleDatasets[0].id);
      }
    }
  };

  // 加载特定数据集的数据
  const loadDatasetData = async (datasetId: string) => {
    try {
      console.log(`正在加载数据集: ${datasetId}`);
      const response = await fetch(`http://localhost:8000/api/v1/data-analyzer/datasets/${datasetId}/data?limit=1000`);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('数据API错误:', errorText);
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      console.log('接收到数据集数据:', result);
      
      if (result.success) {
        // 更新数据集数据
        setDatasets(prevDatasets => 
          prevDatasets.map(dataset => 
            dataset.id === datasetId 
              ? { ...dataset, data: result.data || [] } 
              : dataset
          )
        );
      } else {
        throw new Error(result.error || '获取数据失败');
      }
    } catch (error) {
      console.error('加载数据集数据失败:', error);
      alert('加载数据失败: ' + (error as Error).message);
    }
  };

  // 初始化组件
  useEffect(() => {
    fetchDatasets();
  }, []);

  // 当选择数据集时加载数据
  useEffect(() => {
    if (selectedDataset && datasets.find(d => d.id === selectedDataset)?.source === 'mysql') {
      loadDatasetData(selectedDataset);
    }
  }, [selectedDataset]);

  // 处理文件上传
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      try {
        const processedData = await processor.loadDataFromFile(selectedFile);
        const dataset = convertProcessedDataToDataset(processedData);
        setDatasets([...datasets, dataset]);
        setSelectedDataset(dataset.id);
        addOperation({
          type: 'load',
          config: { fileName: selectedFile.name, fileSize: selectedFile.size }
        });
      } catch (error) {
        alert('文件加载错误: ' + (error as Error).message);
      }
    }
  };

  // 添加数据操作
  const addOperation = (operation: Omit<DataOperation, 'id' | 'timestamp'>) => {
    const newOperation: DataOperation = {
      id: Date.now().toString(),
      ...operation,
      timestamp: new Date()
    };
    setOperations([...operations, newOperation]);
  };

  // 执行Python代码
  const executePythonCode = async () => {
    if (!selectedDataset) {
      alert('请先选择一个数据集');
      return;
    }

    setIsExecuting(true);
    setPythonResult(null);

    try {
      // 获取当前选中数据集的数据
      const dataset = datasets.find(d => d.id === selectedDataset);
      if (!dataset) throw new Error('数据集未找到');

      // 这里应该调用后端API执行Python代码
      // 暂时使用模拟响应
      const result: PythonExecutionResult = {
        success: true,
        output: `执行成功！\n输入数据形状: ${dataset.data.length} 行 × ${dataset.columns.length} 列\n\n数据预览:\n${JSON.stringify(dataset.data.slice(0, 3), null, 2)}`,
        data: dataset.data.slice(0, 5)
      };

      setPythonResult(result);
      addOperation({
        type: 'calculate',
        config: { 
          method: 'python',
          codeLength: pythonCode.length,
          executionTime: new Date().toISOString()
        }
      });

    } catch (error) {
      setPythonResult({
        success: false,
        output: '',
        error: (error as Error).message
      });
    } finally {
      setIsExecuting(false);
    }
  };

  // Excel-like单元格编辑功能
  const handleCellClick = (rowIndex: number, columnName: string) => {
    setEditingCell({ row: rowIndex, col: columnName });
    const currentValue = datasets.find(d => d.id === selectedDataset)?.data[rowIndex][columnName] || '';
    setCellEditValue(String(currentValue));
  };

  const saveCellEdit = () => {
    if (!editingCell || !selectedDataset) return;

    const dataset = datasets.find(d => d.id === selectedDataset);
    if (!dataset) return;

    // 更新数据
    const newData = [...dataset.data];
    newData[editingCell.row] = {
      ...newData[editingCell.row],
      [editingCell.col]: cellEditValue
    };

    // 更新数据集
    const updatedDataset = { ...dataset, data: newData };
    setDatasets(datasets.map(d => d.id === selectedDataset ? updatedDataset : d));

    // 清除编辑状态
    setEditingCell(null);
    setCellEditValue('');

    // 记录操作
    addOperation({
      type: 'manual_edit',
      config: { 
        cell: `${editingCell.col}[${editingCell.row}]`,
        newValue: cellEditValue
      }
    });
  };

  // 获取当前显示的数据
  const getCurrentDisplayData = () => {
    const dataset = datasets.find(d => d.id === selectedDataset);
    return dataset ? dataset.data : [];
  };

  // 渲染数据表格
  const renderDataTable = () => {
    const data = getCurrentDisplayData();
    if (data.length === 0) return <div className="no-data">暂无数据，请选择数据集或上传文件</div>;

    const columns = Object.keys(data[0] || {});
    
    return (
      <div className="data-table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th className="row-number">#</th>
              {columns.map(col => (
                <th key={col} className="column-header">{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.slice(0, 100).map((row, rowIndex) => (
              <tr key={rowIndex}>
                <td className="row-number">{rowIndex + 1}</td>
                {columns.map(col => {
                  const isEditing = editingCell?.row === rowIndex && editingCell?.col === col;
                  return (
                    <td 
                      key={col} 
                      className={`data-cell ${isEditing ? 'editing' : ''}`}
                      onClick={() => handleCellClick(rowIndex, col)}
                    >
                      {isEditing ? (
                        <input
                          type="text"
                          value={cellEditValue}
                          onChange={(e) => setCellEditValue(e.target.value)}
                          onBlur={saveCellEdit}
                          onKeyDown={(e) => e.key === 'Enter' && saveCellEdit()}
                          autoFocus
                        />
                      ) : (
                        String(row[col] ?? '')
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {data.length > 100 && (
          <div className="table-footer">
            显示前100行，共{data.length}行数据
          </div>
        )}
      </div>
    );
  };

  // 渲染执行结果
  const renderExecutionResult = () => {
    if (!pythonResult) return null;

    return (
      <div className={`execution-result ${pythonResult.success ? 'success' : 'error'}`}>
        <h4>执行结果:</h4>
        <div className="result-content">
          <pre className="result-output">{pythonResult.output}</pre>
          {pythonResult.error && (
            <div className="error-message">
              <strong>错误:</strong> {pythonResult.error}
            </div>
          )}
          {pythonResult.data && (
            <div className="result-data">
              <strong>返回数据预览:</strong>
              <pre className="result-data-preview">{JSON.stringify(pythonResult.data, null, 2)}</pre>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="advanced-data-analyzer">
      {/* 顶部工具栏 */}
      <div className="toolbar">
        <div className="toolbar-section">
          <label htmlFor="dataset-select">选择数据集:</label>
          <select 
            id="dataset-select"
            value={selectedDataset}
            onChange={(e) => setSelectedDataset(e.target.value)}
          >
            <option value="">请选择数据集</option>
            {datasets.map(dataset => (
              <option key={dataset.id} value={dataset.id}>
                {dataset.name} ({dataset.source === 'mysql' ? dataset.data.length : 'N/A'}行)
              </option>
            ))}
          </select>
          
          <input
            type="file"
            accept=".csv,.xlsx,.xls,.json"
            onChange={handleFileUpload}
            style={{ display: 'none' }}
            id="file-upload"
          />
          <label htmlFor="file-upload" className="upload-button">
            上传文件
          </label>
        </div>

        <div className="toolbar-section">
          <button 
            className={`tab-button ${activeTab === 'data' ? 'active' : ''}`}
            onClick={() => setActiveTab('data')}
          >
            数据视图
          </button>
          <button 
            className={`tab-button ${activeTab === 'operations' ? 'active' : ''}`}
            onClick={() => setActiveTab('operations')}
          >
            操作历史
          </button>
          <button 
            className={`tab-button ${activeTab === 'python' ? 'active' : ''}`}
            onClick={() => setActiveTab('python')}
          >
            Python处理
          </button>
          <button 
            className={`tab-button ${activeTab === 'visualize' ? 'active' : ''}`}
            onClick={() => setActiveTab('visualize')}
          >
            可视化
          </button>
        </div>
      </div>

      {/* 主要内容区域 */}
      <div className="main-content">
        {/* 数据视图标签页 */}
        {activeTab === 'data' && (
          <div className="tab-content data-tab">
            <div className="data-actions">
              <button className="action-button">筛选数据</button>
              <button className="action-button">排序数据</button>
              <button className="action-button">分组聚合</button>
              <button className="action-button">数据透视</button>
            </div>
            {renderDataTable()}
          </div>
        )}

        {/* 操作历史标签页 */}
        {activeTab === 'operations' && (
          <div className="tab-content operations-tab">
            <h3>操作历史</h3>
            <div className="operations-list">
              {operations.length === 0 ? (
                <p>暂无操作记录</p>
              ) : (
                operations.map(op => (
                  <div key={op.id} className="operation-item">
                    <span className="operation-type">{op.type}</span>
                    <span className="operation-time">
                      {op.timestamp.toLocaleString()}
                    </span>
                    <div className="operation-config">
                      {JSON.stringify(op.config, null, 2)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Python处理标签页 */}
        {activeTab === 'python' && (
          <div className="tab-content python-tab">
            <div className="python-editor-container">
              <div className="editor-header">
                <h3>Python数据处理</h3>
                <button 
                  className="execute-button"
                  onClick={executePythonCode}
                  disabled={isExecuting || !selectedDataset}
                >
                  {isExecuting ? '执行中...' : '执行代码'}
                </button>
              </div>
              
              <textarea
                ref={editorRef}
                className="python-editor"
                value={pythonCode}
                onChange={(e) => setPythonCode(e.target.value)}
                placeholder="在此处编写Python代码..."
              />
              
              {renderExecutionResult()}
            </div>
          </div>
        )}

        {/* 可视化标签页 */}
        {activeTab === 'visualize' && (
          <div className="tab-content visualize-tab">
            <h3>数据可视化</h3>
            <div className="visualization-tools">
              <button className="viz-button">柱状图</button>
              <button className="viz-button">折线图</button>
              <button className="viz-button">饼图</button>
              <button className="viz-button">散点图</button>
              <button className="viz-button">热力图</button>
            </div>
            <div className="chart-preview">
              <p>可视化预览区域</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};