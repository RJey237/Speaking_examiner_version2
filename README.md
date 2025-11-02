# IELTS Speaking Agent

This project is a real-time, AI-powered mock IELTS speaking test simulator. It provides a complete, three-part conversational experience with an AI examiner, including timed sections for Part 2 and a comprehensive performance evaluation at the end of the test.

## Features

- **Real-Time Conversation:** Full-duplex, voice-to-voice interaction with an AI examiner.
- **Voice Activity Detection (VAD):** Automatically detects when the user starts and stops speaking, enabling a hands-free, natural conversational flow.
- **Full 3-Part Test Structure:** Simulates the complete IELTS Speaking test, from the initial introduction to the final discussion.
- **Part 2 Timers & Controls:** Includes a 60-second preparation timer and a 120-second speaking timer for the "Long Turn," with on-screen buttons to skip or finish early.
- **AI-Powered Evaluation:** At the end of the test, the AI provides a detailed evaluation of the user's performance, including an overall band score and feedback on Fluency, Vocabulary, Grammar, and Pronunciation.
- **Visually Enhanced Report:** The final evaluation is displayed in a clean, professional, and easy-to-read format.

## Tech Stack

- **Frontend:**
  - **Framework:** React
  - **Audio Handling:** Web Audio API (`AudioWorklet`) for real-time audio resampling and streaming.
  - **Communication:** WebSocket API for full-duplex communication with the backend.

- **Backend:**
  - **Framework:** Python with FastAPI
  - **Communication:** FastAPI WebSockets
  - **Voice Activity Detection:** Silero VAD via PyTorch
  - **Containerization:** Docker & Docker Compose

- **AI Services:**
  - **Speech-to-Text (STT):** Deepgram (Nova-2 Model)
  - **Language Model (LLM):** Google Gemini (Gemini-2.5-flash Model)
  - **Text-to-Speech (TTS):** Cartesia AI
  - **Voice activity detection (VAD):** snakers4/silero-vad

## Prerequisites

Before you begin, ensure you have the following installed:
- **Docker:** [Get Docker](https://www.docker.com/get-started)
- **Docker Compose:** (Usually included with Docker Desktop)

You will also need API keys from the following services:
- **Google AI Studio** (for Gemini)
- **Deepgram**
- **Cartesia AI**
- **Livekit**

## Setup and Installation

Follow these steps to get the application running locally.

**1. Clone the Repository**

```bash
git clone <https://github.com/RJey237/Speaking_examiner_version2>
cd <Speaking_examiner_version2>
```

**2. Create the Environment File**

In the `backend` directory, create a file named `.env`. Copy the contents of `.env.example` (if provided) or add the following lines, replacing the placeholder values with your actual API keys:

```env
# backend/.env

GEMINI_API_KEY="YOUR_GOOGLE_GEMINI_API_KEY"
DEEPGRAM_API_KEY="YOUR_DEEPGRAM_API_KEY"
CARTESIA_API_KEY="YOUR_CARTESIA_API_KEY"
```

**3. Build and Run with Docker Compose**

From the root directory of the project, run the following command. This will build the Docker images for both the frontend and backend and start the services.

```bash
docker-compose up --build
```

The `--build` flag ensures that any changes you've made to the code or `Dockerfile` are included.

**4. Access the Application**

Once the containers are running, open your web browser and navigate to:

[http://localhost:3000](http://localhost:3000)

The application should load, show a "Connected" status, and you can begin the test.

## Project Structure

```
.
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py         # Main FastAPI and WebSocket logic
│   │   └── prompts.py      # System prompt for the Gemini AI
│   ├── Dockerfile          # Instructions to build the backend image
│   ├── requirements.txt    # Python dependencies
│   └── .env                # (You create this) API keys and secrets
├── frontend/
│   ├── public/
│   │   └── resampler.js    # AudioWorklet for client-side resampling
│   ├── src/
│   │   ├── App.js          # Main React component and application logic
│   │   └── App.css         # Styles for the application
│   ├── Dockerfile          # Multi-stage build for the React app
│   └── package.json
├── docker-compose.yml      # Defines and orchestrates the services
└── README.md               # This file
```

## How It Works

1.  The **React Frontend** captures microphone audio. The `AudioWorklet` (`resampler.js`) downsamples this audio to 16kHz PCM and sends it to the backend in small chunks via a WebSocket.
2.  The **FastAPI Backend** receives these chunks. The **Silero VAD** model analyzes each chunk to determine if the user is speaking.
3.  When the VAD detects a sufficiently long period of silence after speech, it considers the user's turn to be over.
4.  The complete audio utterance is sent to the **Deepgram API** for transcription (STT).
5.  The resulting text is sent to the **Google Gemini API**, which acts as the IELTS examiner and generates the next question or response.
6.  The AI's text response is sent to the **Cartesia API** for voice synthesis (TTS).
7.  The backend sends the AI's text and the generated audio back to the frontend via the WebSocket.
8.  The frontend displays the text and plays the audio, completing the conversational loop.