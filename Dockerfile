# Use Python 3.11 slim image
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Copy requirements and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY src/interceptor.py src/

# Expose default port
EXPOSE 8877

# Set environment variables
ENV PYTHONUNBUFFERED=1

# Run the application
CMD ["python", "src/interceptor.py"]
