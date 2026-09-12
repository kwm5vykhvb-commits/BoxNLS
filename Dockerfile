FROM node:20-bullseye-slim

# Install ffmpeg
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci || npm install

# Copy source and build
COPY . .
RUN npm run build

# Expose port
EXPOSE 3000

# Start command
CMD ["npm", "start"]
