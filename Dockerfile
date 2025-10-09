FROM python:3.13-slim

WORKDIR /app

# Copy project files
COPY . .

# Install uv and sync dependencies
RUN pip install uv && uv sync

# Configure for HTTP transport
ENV MCP_TRANSPORT=http
ENV MCP_HOST=0.0.0.0
ENV MCP_PORT=8000

# Run the server
CMD ["uv", "run", "deribit-mcp"]
