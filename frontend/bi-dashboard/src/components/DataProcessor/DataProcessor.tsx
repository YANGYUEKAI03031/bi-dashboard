// src/components/DataProcessor/DataProcessor.tsx
import React, { useState, useEffect } from 'react';
import { DataProcessorService, ProcessedData, DataOperation } from '../../services/dataProcessor';
import './DataProcessor.css';

export const DataProcessor: React.FC = () => {
  const [datasets, setDatasets] = useState<ProcessedData[]>([]);
  const [selectedDataset, setSelectedDataset] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'upload' | 'process' | 'preview'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [filterColumn, setFilterColumn] = useState('');
  const [filterCondition, setFilterCondition] = useState('equals');
  const [filterValue, setFilterValue] = useState('');
  const [sortColumn, setSortColumn] = useState('');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [newColumnName, setNewColumnName] = useState('');
  const [formula, setFormula] = useState('');
  const [groupByColumn, setGroupByColumn] = useState('');
  const [aggregations, setAggregations] = useState<Record<string, string>>({});

  const processor = DataProcessorService.getInstance();

  useEffect(() => {
    setDatasets(processor.getAllDatasets());
  }, []);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      try {
        setFile(selectedFile);
        const dataset = await processor.loadDataFromFile(selectedFile);
        setDatasets([...datasets, dataset]);
        setSelectedDataset(dataset.id);
        setActiveTab('process');
      } catch (error) {
        alert('Error loading file: ' + (error as Error).message);
      }
    }
  };

  const handleFilter = () => {
    if (selectedDataset && filterColumn && filterValue) {
      try {
        const updatedDataset = processor.filterData(
          selectedDataset,
          filterColumn,
          filterCondition,
          filterValue
        );
        setDatasets(datasets.map(ds => ds.id === selectedDataset ? updatedDataset : ds));
      } catch (error) {
        alert('Error applying filter: ' + (error as Error).message);
      }
    }
  };

  const handleSort = () => {
    if (selectedDataset && sortColumn) {
      try {
        const updatedDataset = processor.sortData(
          selectedDataset,
          sortColumn,
          sortDirection
        );
        setDatasets(datasets.map(ds => ds.id === selectedDataset ? updatedDataset : ds));
      } catch (error) {
        alert('Error sorting data: ' + (error as Error).message);
      }
    }
  };

  const handleCalculate = () => {
    if (selectedDataset && newColumnName && formula) {
      try {
        const updatedDataset = processor.calculateColumn(
          selectedDataset,
          newColumnName,
          formula
        );
        setDatasets(datasets.map(ds => ds.id === selectedDataset ? updatedDataset : ds));
        setNewColumnName('');
        setFormula('');
      } catch (error) {
        alert('Error calculating column: ' + (error as Error).message);
      }
    }
  };

  const handleGroup = () => {
    if (selectedDataset && groupByColumn && Object.keys(aggregations).length > 0) {
      try {
        const updatedDataset = processor.groupData(
          selectedDataset,
          groupByColumn,
          aggregations
        );
        setDatasets(datasets.map(ds => ds.id === selectedDataset ? updatedDataset : ds));
      } catch (error) {
        alert('Error grouping data: ' + (error as Error).message);
      }
    }
  };

  const handleSave = async () => {
    if (selectedDataset) {
      try {
        const downloadUrl = await processor.saveProcessedData(selectedDataset);
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = `processed_${datasets.find(d => d.id === selectedDataset)?.fileName || 'data'}.json`;
        link.click();
        URL.revokeObjectURL(downloadUrl);
      } catch (error) {
        alert('Error saving data: ' + (error as Error).message);
      }
    }
  };

  const currentDataset = datasets.find(ds => ds.id === selectedDataset);

  return (
    <div className="data-processor">
      <div className="tabs">
        <button 
          className={activeTab === 'upload' ? 'active' : ''}
          onClick={() => setActiveTab('upload')}
        >
          Upload Data
        </button>
        <button 
          className={activeTab === 'process' ? 'active' : ''}
          onClick={() => setActiveTab('process')}
          disabled={!selectedDataset}
        >
          Process Data
        </button>
        <button 
          className={activeTab === 'preview' ? 'active' : ''}
          onClick={() => setActiveTab('preview')}
          disabled={!selectedDataset}
        >
          Preview Results
        </button>
      </div>

      {activeTab === 'upload' && (
        <div className="upload-tab">
          <h3>Upload Data File</h3>
          <input
            type="file"
            accept=".csv,.json"
            onChange={handleFileUpload}
          />
          {file && <p>Selected file: {file.name}</p>}
        </div>
      )}

      {activeTab === 'process' && currentDataset && (
        <div className="process-tab">
          <h3>Process Data: {currentDataset.fileName}</h3>
          
          <div className="processing-tools">
            {/* Filter Section */}
            <div className="tool-section">
              <h4>Filter Data</h4>
              <select value={filterColumn} onChange={(e) => setFilterColumn(e.target.value)}>
                <option value="">Select Column</option>
                {currentDataset.columns.map(col => (
                  <option key={col} value={col}>{col}</option>
                ))}
              </select>
              <select value={filterCondition} onChange={(e) => setFilterCondition(e.target.value)}>
                <option value="equals">Equals</option>
                <option value="contains">Contains</option>
                <option value="greater">Greater Than</option>
                <option value="less">Less Than</option>
                <option value="not_equals">Not Equals</option>
              </select>
              <input
                type="text"
                value={filterValue}
                onChange={(e) => setFilterValue(e.target.value)}
                placeholder="Filter value"
              />
              <button onClick={handleFilter}>Apply Filter</button>
            </div>

            {/* Sort Section */}
            <div className="tool-section">
              <h4>Sort Data</h4>
              <select value={sortColumn} onChange={(e) => setSortColumn(e.target.value)}>
                <option value="">Select Column</option>
                {currentDataset.columns.map(col => (
                  <option key={col} value={col}>{col}</option>
                ))}
              </select>
              <select value={sortDirection} onChange={(e) => setSortDirection(e.target.value as 'asc' | 'desc')}>
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
              <button onClick={handleSort}>Apply Sort</button>
            </div>

            {/* Calculate Section */}
            <div className="tool-section">
              <h4>Calculate New Column</h4>
              <input
                type="text"
                value={newColumnName}
                onChange={(e) => setNewColumnName(e.target.value)}
                placeholder="New column name"
              />
              <input
                type="text"
                value={formula}
                onChange={(e) => setFormula(e.target.value)}
                placeholder="Formula (e.g., price * quantity)"
              />
              <button onClick={handleCalculate}>Add Column</button>
            </div>

            {/* Group Section */}
            <div className="tool-section">
              <h4>Group Data</h4>
              <select value={groupByColumn} onChange={(e) => setGroupByColumn(e.target.value)}>
                <option value="">Group by Column</option>
                {currentDataset.columns.map(col => (
                  <option key={col} value={col}>{col}</option>
                ))}
              </select>
              <button onClick={handleGroup}>Apply Grouping</button>
            </div>
          </div>

          <div className="operations-history">
            <h4>Operations History</h4>
            {currentDataset.operations.map(op => (
              <div key={op.id} className="operation-item">
                <span className="operation-type">{op.type}</span>
                <span className="operation-column">{op.column}</span>
                <span className="operation-timestamp">
                  {op.timestamp.toLocaleString()}
                </span>
              </div>
            ))}
          </div>

          <button className="save-button" onClick={handleSave}>
            Save Processed Data
          </button>
        </div>
      )}

      {activeTab === 'preview' && currentDataset && (
        <div className="preview-tab">
          <h3>Preview: {currentDataset.fileName}</h3>
          <div className="data-info">
            <p>Rows: {currentDataset.processedData.length}</p>
            <p>Columns: {currentDataset.columns.length}</p>
            <p>Operations Applied: {currentDataset.operations.length}</p>
          </div>
          
          <div className="data-preview">
            <table>
              <thead>
                <tr>
                  {currentDataset.columns.map(col => (
                    <th key={col}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {currentDataset.processedData.slice(0, 10).map((row, index) => (
                  <tr key={index}>
                    {currentDataset.columns.map(col => (
                      <td key={col}>{String(row[col] ?? '')}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            
            {currentDataset.processedData.length > 10 && (
              <p>Showing first 10 rows of {currentDataset.processedData.length} total rows</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};