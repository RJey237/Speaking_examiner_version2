# ================================
# Stage 1: Build the React app
# ================================
FROM node:18-alpine AS builder

# Create app directory
WORKDIR /app

# Copy and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the source code
COPY . .

# Ensure VAD + ONNXRuntime files exist in the public folder
# (This guarantees your model and runtime are included in the final build)
RUN mkdir -p public && \
    cp node_modules/@ricky0123/vad-web/dist/silero_vad_v5.onnx public/ && \
    cp node_modules/onnxruntime-web/dist/*.wasm public/ && \
    cp node_modules/onnxruntime-web/dist/*.mjs public/

# Build production bundle
RUN npm run build

# ================================
# Stage 2: Serve the app with Nginx
# ================================
FROM nginx:stable-alpine

# Copy the compiled app from builder stage
COPY --from=builder /app/build /usr/share/nginx/html

# Expose port 80
EXPOSE 80

# Start Nginx
CMD ["nginx", "-g", "daemon off;"]
