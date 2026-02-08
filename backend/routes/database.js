// backend/routes/database.js
const express = require('express');
const router = express.Router();

// 假设你已经有一个数据库连接
const db = require('../db');

// 获取所有表名
router.get('/tables', async (req, res) => {
  try {
    const result = await db.query('SHOW TABLES');
    const tables = result.map(row => Object.values(row)[0]);
    res.json({ tables });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get tables' });
  }
});

// 执行SQL查询
router.post('/query', async (req, res) => {
  try {
    const { sql } = req.body;
    const result = await db.query(sql);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Query execution failed' });
  }
});

// 获取表预览
router.get('/table/:tableName/preview', async (req, res) => {
  try {
    const { tableName } = req.params;
    const result = await db.query(`SELECT * FROM ${tableName} LIMIT 100`);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get table preview' });
  }
});

// 获取数据库统计
router.get('/stats', async (req, res) => {
  try {
    const [tablesResult] = await db.query('SHOW TABLES');
    const tableCount = tablesResult.length;
    
    const [rowsResult] = await db.query('SELECT SUM(TABLE_ROWS) as total_rows FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE()');
    const totalRows = rowsResult[0].total_rows;
    
    res.json({
      tableCount,
      totalRows,
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get database stats' });
  }
});

module.exports = router;