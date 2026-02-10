# backend/app/services/data_storage.py
"""
数据存储服务 - 保存处理后的数据
"""
import json
import uuid
from datetime import datetime
from typing import Dict, Any, List, Optional
import aiomysql
from app.core.config import settings

class DataStorageService:
    def __init__(self):
        self.connection = None
    
    async def connect(self):
        """建立数据库连接"""
        if not self.connection:
            self.connection = await aiomysql.connect(
                host=settings.MYSQL_HOST,
                port=settings.MYSQL_PORT,
                user=settings.MYSQL_USER,
                password=settings.MYSQL_PASSWORD,
                db=settings.MYSQL_DATABASE,
                charset='utf8mb4'
            )
    
    async def save_processed_data(self, 
                                original_table: str,
                                processed_data: List[Dict],
                                operations: List[Dict],
                                user_id: Optional[str] = None) -> str:
        """
        保存处理后的数据到数据库
        
        Args:
            original_table: 原始表名
            processed_data: 处理后的数据
            operations: 操作历史
            user_id: 用户ID（可选）
            
        Returns:
            保存的数据集ID
        """
        await self.connect()
        
        # 生成唯一数据集ID
        dataset_id = str(uuid.uuid4())
        
        try:
            cursor = await self.connection.cursor()
            
            # 1. 创建保存处理数据的表
            save_table_name = f"processed_{dataset_id.replace('-', '_')}"
            
            # 根据数据结构动态创建表
            if processed_data:
                columns_sql = self._generate_create_table_sql(processed_data[0])
                create_table_sql = f"""
                CREATE TABLE `{save_table_name}` (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    {columns_sql}
                )
                """
                await cursor.execute(create_table_sql)
                
                # 插入数据
                await self._insert_processed_data(cursor, save_table_name, processed_data)
            
            # 2. 保存元数据到metadata表
            metadata_sql = """
            INSERT INTO processed_datasets_metadata 
            (dataset_id, original_table, save_table_name, operations, user_id, created_at)
            VALUES (%s, %s, %s, %s, %s, %s)
            """
            
            operations_json = json.dumps(operations, ensure_ascii=False)
            await cursor.execute(metadata_sql, (
                dataset_id,
                original_table,
                save_table_name,
                operations_json,
                user_id,
                datetime.now()
            ))
            
            await self.connection.commit()
            return dataset_id
            
        except Exception as e:
            await self.connection.rollback()
            raise e
        finally:
            await cursor.close()
    
    def _generate_create_table_sql(self, sample_row: Dict) -> str:
        """根据示例行生成CREATE TABLE SQL"""
        columns = []
        for key, value in sample_row.items():
            # 根据数据类型推断字段类型
            if isinstance(value, int):
                column_type = "BIGINT"
            elif isinstance(value, float):
                column_type = "DECIMAL(15,6)"
            elif isinstance(value, bool):
                column_type = "BOOLEAN"
            else:
                column_type = "TEXT"
            
            # 处理特殊字符
            safe_key = key.replace(' ', '_').replace('-', '_')
            columns.append(f"`{safe_key}` {column_type}")
        
        return ",\n    ".join(columns)
    
    async def _insert_processed_data(self, cursor, table_name: str, data: List[Dict]):
        """插入处理后的数据"""
        if not data:
            return
            
        # 准备INSERT语句
        sample_row = data[0]
        columns = [key.replace(' ', '_').replace('-', '_') for key in sample_row.keys()]
        placeholders = ','.join(['%s'] * len(columns))
        columns_str = ','.join([f'`{col}`' for col in columns])
        
        insert_sql = f"INSERT INTO `{table_name}` ({columns_str}) VALUES ({placeholders})"
        
        # 批量插入数据
        batch_size = 1000
        for i in range(0, len(data), batch_size):
            batch = data[i:i + batch_size]
            values_list = []
            
            for row in batch:
                values = []
                for key in sample_row.keys():
                    value = row.get(key)
                    # 处理None值
                    if value is None:
                        values.append(None)
                    else:
                        values.append(str(value))
                values_list.append(tuple(values))
            
            await cursor.executemany(insert_sql, values_list)
    
    async def get_saved_dataset(self, dataset_id: str) -> Optional[Dict]:
        """获取保存的数据集"""
        await self.connect()
        
        try:
            cursor = await self.connection.cursor(aiomysql.DictCursor)
            
            # 获取元数据
            meta_sql = "SELECT * FROM processed_datasets_metadata WHERE dataset_id = %s"
            await cursor.execute(meta_sql, (dataset_id,))
            metadata = await cursor.fetchone()
            
            if not metadata:
                return None
            
            # 获取数据
            data_sql = f"SELECT * FROM `{metadata['save_table_name']}`"
            await cursor.execute(data_sql)
            data = await cursor.fetchall()
            
            return {
                'metadata': metadata,
                'data': data
            }
            
        finally:
            await cursor.close()
    
    async def list_saved_datasets(self, user_id: Optional[str] = None) -> List[Dict]:
        """列出保存的数据集"""
        await self.connect()
        
        try:
            cursor = await self.connection.cursor(aiomysql.DictCursor)
            
            if user_id:
                sql = "SELECT * FROM processed_datasets_metadata WHERE user_id = %s ORDER BY created_at DESC"
                await cursor.execute(sql, (user_id,))
            else:
                sql = "SELECT * FROM processed_datasets_metadata ORDER BY created_at DESC"
                await cursor.execute(sql)
            
            return await cursor.fetchall()
            
        finally:
            await cursor.close()

# 单例实例
data_storage_service = DataStorageService()