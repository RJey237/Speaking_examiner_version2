# backend/Dockerfile

FROM python:3.11-slim

# Set the working directory in the container
WORKDIR /app

# --- THE FIX IS HERE ---
# Install system dependencies: ffmpeg for audio processing AND curl for the healthcheck.
RUN apt-get update && apt-get install -y ffmpeg curl

# Copy the requirements file and install dependencies
COPY ./requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir --upgrade -r /app/requirements.txt

# Copy the rest of the application code
COPY . /app

# Command to run the application
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]