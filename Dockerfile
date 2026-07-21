FROM python:3.11-slim

WORKDIR /app

# 先单独拷依赖文件，利用 Docker 层缓存
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 再拷代码
COPY backend ./backend
COPY frontend ./frontend

# SQLite 数据目录（可挂卷持久化）
RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
