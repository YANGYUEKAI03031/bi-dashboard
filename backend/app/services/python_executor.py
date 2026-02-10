# backend/app/services/python_executor.py
"""
Python代码执行服务 - 安全沙箱环境
"""
import pandas as pd
import numpy as np
import json
import io
import sys
import traceback
from typing import Dict, Any, List, Optional
import ast
import copy
from contextlib import redirect_stdout

class RestrictedPythonExecutor:
    def __init__(self):
        # 限制的内置函数 - 只允许安全的操作
        self.allowed_builtins = {
            'len': len,
            'range': range,
            'enumerate': enumerate,
            'zip': zip,
            'sorted': sorted,
            'min': min,
            'max': max,
            'sum': sum,
            'abs': abs,
            'round': round,
            'str': str,
            'int': int,
            'float': float,
            'bool': bool,
            'list': list,
            'dict': dict,
            'tuple': tuple,
            'set': set,
            'print': print,
            'type': type,
            'isinstance': isinstance,
            'hasattr': hasattr,
            'getattr': getattr,
        }
        
        # 允许的模块
        self.allowed_modules = {
            'pd': pd,
            'np': np,
            'json': json,
        }
        
        # 创建安全的全局命名空间
        self.safe_globals = {
            '__builtins__': self.allowed_builtins,
            **self.allowed_modules
        }
        
    def validate_code(self, code: str) -> bool:
        """验证代码安全性"""
        try:
            tree = ast.parse(code)
            
            # 禁止的节点类型
            dangerous_nodes = (
                ast.Import,
                ast.ImportFrom,
                ast.Call,  # 我们会特别检查Call节点
            )
            
            for node in ast.walk(tree):
                # 检查危险节点
                if isinstance(node, dangerous_nodes):
                    if isinstance(node, ast.Call):
                        # 允许安全的函数调用
                        if hasattr(node.func, 'id'):
                            func_name = node.func.id
                            if func_name not in self.allowed_builtins:
                                return False
                        elif hasattr(node.func, 'attr'):
                            # 检查方法调用
                            if node.func.attr in ['exec', 'eval']:
                                return False
                    else:
                        return False
                        
            return True
        except SyntaxError:
            return False
    
    def execute_code(self, code: str, data: List[Dict] = None) -> Dict[str, Any]:
        """
        在受限环境中执行Python代码
        
        Args:
            code: 要执行的Python代码
            data: 输入数据（字典列表格式）
            
        Returns:
            执行结果字典
        """
        # 验证代码安全性
        if not self.validate_code(code):
            return {
                'success': False,
                'output': '',
                'error': '代码包含不允许的操作',
                'data': None
            }
        
        # 准备执行环境
        locals_dict = {}
        
        # 如果有数据，将其转换为DataFrame并添加到环境
        if data:
            try:
                df = pd.DataFrame(data)
                locals_dict['data'] = data
                locals_dict['df'] = df
            except Exception as e:
                return {
                    'success': False,
                    'output': '',
                    'error': f'数据转换失败: {str(e)}',
                    'data': None
                }
        
        # 捕获输出
        output_buffer = io.StringIO()
        
        try:
            with redirect_stdout(output_buffer):
                # 在受限环境中执行代码
                exec(code, self.safe_globals.copy(), locals_dict)
            
            # 获取执行输出
            output = output_buffer.getvalue()
            
            # 查找返回结果
            result_data = None
            
            # 优先查找result变量
            if 'result' in locals_dict:
                result_data = self._serialize_result(locals_dict['result'])
            # 查找处理后的df
            elif 'df' in locals_dict and isinstance(locals_dict['df'], pd.DataFrame):
                result_data = self._serialize_dataframe(locals_dict['df'])
            # 查找其他有意义的变量
            elif len(locals_dict) > 0:
                for var_name in reversed(list(locals_dict.keys())):
                    if not var_name.startswith('_') and var_name not in ['data', 'df']:
                        result_data = self._serialize_result(locals_dict[var_name])
                        break
            
            return {
                'success': True,
                'output': output,
                'data': result_data,
                'variables': list(locals_dict.keys())
            }
            
        except Exception as e:
            error_traceback = traceback.format_exc()
            return {
                'success': False,
                'output': output_buffer.getvalue(),
                'error': str(e),
                'traceback': error_traceback,
                'data': None
            }
    
    def _serialize_result(self, result):
        """序列化执行结果"""
        try:
            if isinstance(result, pd.DataFrame):
                return self._serialize_dataframe(result)
            elif isinstance(result, pd.Series):
                return result.tolist()
            elif isinstance(result, (list, dict, str, int, float, bool)):
                return result
            elif hasattr(result, 'to_dict'):
                return result.to_dict()
            elif hasattr(result, '__iter__') and not isinstance(result, (str, bytes)):
                return list(result)
            else:
                return str(result)
        except Exception as e:
            return f"序列化失败: {str(e)}"
    
    def _serialize_dataframe(self, df: pd.DataFrame) -> List[Dict]:
        """将DataFrame序列化为字典列表"""
        try:
            # 限制返回行数
            limited_df = df.head(1000)
            # 处理NaN值
            return limited_df.replace({pd.NaT: None, pd.NaN: None}).to_dict('records')
        except Exception as e:
            return [{'error': f'序列化DataFrame失败: {str(e)}'}]

# 单例实例
python_executor = RestrictedPythonExecutor()