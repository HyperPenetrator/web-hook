# Use Node.js 20 slim image for a lightweight build
FROM node:20-slim

# Install system dependencies needed for some native packages
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy application source code
COPY . .

# Expose port (Hugging Face Spaces routes HTTP traffic to port 7860)
EXPOSE 7860

# Define environment defaults
ENV PORT=7860
ENV NODE_ENV=production

# Start the application
CMD ["npm", "start"]
