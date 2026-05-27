# app/services/realtime_sync.py
import asyncio
import json
import logging

import websockets

from app.core.cache import cache_service

logger = logging.getLogger(__name__)


class RealTimeSyncService:
    """实时数据同步服务"""

    def __init__(self):
        self.connections: dict[str, list] = {}
        self.watchers: dict[str, asyncio.Task] = {}
        self.running = False

    async def start(self):
        """启动实时同步服务"""
        self.running = True
        logger.info("Real-time sync service started")

    async def stop(self):
        """停止实时同步服务"""
        self.running = False
        # 取消所有监视任务
        for task in self.watchers.values():
            task.cancel()
        logger.info("Real-time sync service stopped")

    async def subscribe_to_table(self, websocket, table_name: str):
        """订阅表变化"""
        if table_name not in self.connections:
            self.connections[table_name] = []

        self.connections[table_name].append(websocket)
        logger.info(f"New subscription to table: {table_name}")

        try:
            # 发送初始数据
            await self._send_initial_data(websocket, table_name)

            # 保持连接
            while self.running:
                try:
                    message = await websocket.recv()
                    # 处理客户端消息
                    await self._handle_client_message(websocket, table_name, message)
                except websockets.exceptions.ConnectionClosed:
                    break

        finally:
            # 清理连接
            if table_name in self.connections:
                self.connections[table_name].remove(websocket)
                if not self.connections[table_name]:
                    del self.connections[table_name]
            logger.info(f"Unsubscribed from table: {table_name}")

    async def _send_initial_data(self, websocket, table_name: str):
        """发送初始数据"""
        try:
            # 从缓存获取最新数据
            cache_key = f"table_data:{table_name}"
            cached_data = await cache_service.get(cache_key)

            if cached_data:
                await websocket.send(json.dumps({"event": "initial_data", "table": table_name, "data": cached_data}))
        except Exception as e:
            logger.error(f"Failed to send initial data: {e}")

    async def _handle_client_message(self, websocket, table_name: str, message: str):
        """处理客户端消息"""
        try:
            data = json.loads(message)
            action = data.get("action")

            if action == "refresh":
                # 客户端请求刷新数据
                await self._send_initial_data(websocket, table_name)
            elif action == "unsubscribe":
                # 客户端取消订阅
                await websocket.close()

        except json.JSONDecodeError:
            logger.warning("Invalid JSON message received")
        except Exception as e:
            logger.error(f"Error handling client message: {e}")


# 全局实例
realtime_service = RealTimeSyncService()
