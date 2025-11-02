import os
import json
import base64
import asyncio
import torch
import wave
import io
import re
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import google.generativeai as genai

# --- FINAL, CORRECTED IMPORTS for deepgram-sdk v5+ ---
from deepgram import AsyncDeepgramClient
from deepgram.core.api_error import ApiError
# ----------------------------------------------------

from cartesia import Cartesia
from .prompts import SYSTEM_PROMPT

# --- Load Environment Variables & Initialize APIs ---
load_dotenv()
DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY")
CARTESIA_API_KEY = os.getenv("CARTESIA_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

# Use the ASYNC client for an async application
deepgram_client = AsyncDeepgramClient() 
cartesia_client = Cartesia(api_key=CARTESIA_API_KEY)
genai.configure(api_key=GEMINI_API_KEY)
gemini_model = genai.GenerativeModel('gemini-2.5-flash')

# --- VAD Setup ---
torch.set_num_threads(1)
VAD_MODEL, VAD_UTILS = torch.hub.load(
    repo_or_dir='snakers4/silero-vad',
    model='silero_vad',
    force_reload=False,
    trust_repo=True
)
VAD_SAMPLE_RATE = 16000
VAD_THRESHOLD = 0.5
MIN_SPEECH_DURATION_S = 0.25
SILENCE_DURATION_S = 1.2

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# --- Connection Manager ---
class ConnectionManager:
    def __init__(self):
        self.speech_buffer = bytearray()
        self.last_speech_time = None
        self.is_speaking = False

    def reset(self):
        self.speech_buffer = bytearray()
        self.last_speech_time = None
        self.is_speaking = False

# --- IELTS Logic ---
class IeltsTestManager:
    def __init__(self):
        self.chat_history = [{'role': 'user', 'parts': [SYSTEM_PROMPT]}, {'role': 'model', 'parts': ["OK. I am ready to begin the test."]}]
        self.exam_state = "START"
        self.part_1_question_count = 0
        self.part_3_question_count = 0

    async def next_turn(self, user_response: str = "") -> str:
        if user_response: self.chat_history.append({"role": "user", "parts": [user_response]})
        try:
            chat = gemini_model.start_chat(history=self.chat_history)
            prompt = "PROCEED"
            if self.exam_state == "START":
                prompt = "What is the very first thing you should say to the user to start the test?"
            elif self.exam_state == "EVALUATION":
                prompt = "[SYSTEM: The test is complete. Provide the final evaluation JSON.]"
            
            response = await chat.send_message_async(prompt)
            ai_response = response.text.strip()
            if self.exam_state != "EVALUATION":
                self.chat_history.append({"role": "model", "parts": [ai_response]})
            return ai_response
        except Exception as e:
            print(f"[MANAGER ERROR] Gemini API call failed: {e}")
            return "I'm sorry, an error occurred."

# --- Transcription Function (Deepgram) ---
async def transcribe_audio(pcm_data: bytes) -> str:
    print("[DEBUG] Entered transcribe_audio function.")
    try:
        if len(pcm_data) < 2048:
            print("[DEEPGRAM LOG] Audio data too short — skipping.")
            return ""

        with io.BytesIO() as in_memory_wav:
            with wave.open(in_memory_wav, 'wb') as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2)
                wf.setframerate(VAD_SAMPLE_RATE)
                wf.writeframes(pcm_data)
            wav_data = in_memory_wav.getvalue()

        print("[DEEPGRAM LOG] Sending audio to Deepgram for transcription...")
        
        # *** THE FINAL, DEFINITIVE FIX IS HERE ***
        # Using the modern, simplified syntax with all arguments as keyword arguments
        response = await deepgram_client.listen.v1.media.transcribe_file(
            request=wav_data,
            model="nova-2",
            punctuate=True,
            smart_format=True,
            language="en",
            keywords=["IELTS:5", "examiner:3", "Sheldon:5"]
        )

        transcript = response.results.channels[0].alternatives[0].transcript.strip()
        if transcript:
            print(f"[DEEPGRAM LOG] Transcription successful: {transcript}")
            return transcript
        else:
            print("[DEEPGRAM WARNING] Empty transcript — likely silence or bad API key.")
            return ""

    except ApiError as e:
        print(f"Deepgram API Error: {e.status_code} - {e.body}")
        return ""
    except Exception as e:
        print(f"Deepgram transcription error: {e}")
        return ""

# --- TTS Function (Cartesia) ---
async def generate_tts_audio(text: str) -> bytes:
    try:
        tts_generator = cartesia_client.tts.bytes(
            model_id="sonic-english",
            transcript=text,
            voice={"mode": "id", "id": "5cad89c9-d88a-4832-89fb-55f2f16d13d3"},
            output_format={"container": "wav", "encoding": "pcm_s16le", "sample_rate": 24000}
        )
        return b"".join([chunk for chunk in tts_generator])
    except Exception as e:
        print(f"Cartesia TTS error: {e}")
        return b""

def parse_evaluation_json(text: str):
    match = re.search(r"\[EVALUATION_JSON_START\](.*)\[EVALUATION_JSON_END\]", text, re.DOTALL)
    if not match: return None
    try:
        return json.loads(match.group(1).strip())
    except json.JSONDecodeError:
        return None

# --- Main WebSocket Logic ---
@app.websocket("/")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    ielts_manager = IeltsTestManager()
    vad_manager = ConnectionManager()
    active_timer_task = None

    async def send_ai_turn(ai_text: str):
        nonlocal active_timer_task
        
        if "[EVALUATION_JSON_START]" in ai_text:
            print("[BACKEND LOG] Final evaluation received from AI.")
            ielts_manager.exam_state = "ENDED"
            evaluation_data = parse_evaluation_json(ai_text)
            if evaluation_data:
                await websocket.send_json({"type": "final_evaluation", "data": evaluation_data})
            return

        response_data = {"type": "transcript", "speaker": "AI", "data": ai_text}
        text_for_speech = ai_text
        lower_ai_text = ai_text.lower()

        text_for_speech = re.sub(r'\[SYSTEM:.*?\]', '', text_for_speech)
        
        if "alright, that's the end of part 1" in lower_ai_text:
            ielts_manager.exam_state = "PART_2_PREP"
            response_data["start_timer_on_finish"] = "prep_timer"
            text_for_speech = re.sub(r'\[CUE_CARD_(START|END)\]|\*|_', '', text_for_speech)
        elif "your preparation time is up" in lower_ai_text:
            ielts_manager.exam_state = "PART_2_SPEAKING"
            response_data["start_timer_on_finish"] = "speak_timer"
        
        await websocket.send_json(response_data)
        
        audio_bytes = await generate_tts_audio(text_for_speech.strip())
        if audio_bytes:
            await websocket.send_json({"type": "audio", "data": base64.b64encode(audio_bytes).decode("utf-8")})

    async def handle_prep_timer_end():
        print("[TIMER LOG] Prep timer ended.")
        next_prompt = "Your preparation time is up. Please start speaking now."
        ielts_manager.chat_history.append({"role": "model", "parts": [next_prompt]})
        await send_ai_turn(next_prompt)

    async def handle_speak_timer_end():
        print("[TIMER LOG] Speak timer ended. Finalizing Part 2 turn.")
        await websocket.send_json({"type": "force_stop_listening"})
        user_monologue = await transcribe_audio(bytes(vad_manager.speech_buffer)) or "(User was silent or STT failed)"
        vad_manager.reset()
        await websocket.send_json({"type": "transcript", "speaker": "User", "data": user_monologue})
        prompt_for_ai = f"{user_monologue}\n\n[SYSTEM: The user's Part 2 monologue is complete. Ask one follow-up question.]"
        ai_text = await ielts_manager.next_turn(prompt_for_ai)
        ielts_manager.exam_state = "PART_2_FOLLOW_UP"
        await send_ai_turn(ai_text)

    async def start_timer(duration, timer_type):
        nonlocal active_timer_task
        print(f"[TIMER LOG] Starting {timer_type} for {duration} seconds.")
        await websocket.send_json({"type": "timer_start", "timer_type": timer_type, "duration": duration})
        try:
            for i in range(duration, 0, -1):
                await asyncio.sleep(1)
                await websocket.send_json({"type": "timer_update", "remaining": i - 1})
            print(f"[TIMER LOG] Timer {timer_type} finished.")
            await websocket.send_json({"type": "timer_end"})
            if timer_type == "prep_timer": await handle_prep_timer_end()
            elif timer_type == "speak_timer": await handle_speak_timer_end()
        except asyncio.CancelledError:
            print(f"[TIMER LOG] Timer {timer_type} was cancelled by user.")
        finally:
            active_timer_task = None

    try:
        while True:
            message = await websocket.receive_text()
            data = json.loads(message)
            msg_type = data.get("type")

            if msg_type == "start_test":
                ai_text = await ielts_manager.next_turn()
                ielts_manager.exam_state = "PART_1"
                ielts_manager.part_1_question_count = 1
                await send_ai_turn(ai_text)
            elif msg_type == "tts_finished_start_timer":
                timer_type = data.get("timer_type")
                duration = 60 if timer_type == "prep_timer" else 120
                if not active_timer_task:
                    active_timer_task = asyncio.create_task(start_timer(duration, timer_type))
            elif msg_type == "skip_prep_timer":
                if active_timer_task: active_timer_task.cancel()
                await handle_prep_timer_end()
            elif msg_type == "finish_speaking":
                if active_timer_task: active_timer_task.cancel()
                await handle_speak_timer_end()
            elif msg_type == "audio_chunk":
                if ielts_manager.exam_state in ["PART_2_PREP", "ENDED"]: continue
                chunk = bytearray(base64.b64decode(data["data"]))
                audio_tensor = torch.frombuffer(chunk, dtype=torch.int16).float() / 32768.0
                speech_prob = VAD_MODEL(audio_tensor, VAD_SAMPLE_RATE).item()
                current_time = asyncio.get_event_loop().time()
                if speech_prob > VAD_THRESHOLD:
                    if not vad_manager.is_speaking: vad_manager.is_speaking = True
                    vad_manager.speech_buffer.extend(chunk)
                    vad_manager.last_speech_time = current_time
                elif vad_manager.is_speaking:
                    if ielts_manager.exam_state == "PART_2_SPEAKING":
                        vad_manager.speech_buffer.extend(chunk); continue
                    if current_time - vad_manager.last_speech_time > SILENCE_DURATION_S:
                        if len(vad_manager.speech_buffer) / (VAD_SAMPLE_RATE * 2) > MIN_SPEECH_DURATION_S:
                            user_speech_data = bytes(vad_manager.speech_buffer)
                            vad_manager.reset()
                            user_text = await transcribe_audio(user_speech_data)
                            
                            if not user_text or len(user_text.split()) < 2:
                                print("[BACKEND LOG] User speech was too short or empty. Re-prompting.")
                                display_text = "(User was silent or response was too short)"
                                system_prompt = "[SYSTEM: The user was silent or their response was too short. Ask the question again in a slightly different way.]"
                                await websocket.send_json({"type": "transcript", "speaker": "User", "data": display_text})
                                ai_text = await ielts_manager.next_turn(system_prompt)
                            else:
                                await websocket.send_json({"type": "transcript", "speaker": "User", "data": user_text})
                                if ielts_manager.exam_state == "PART_3": ielts_manager.part_3_question_count += 1
                                if ielts_manager.part_3_question_count >= 2:
                                    print("[BACKEND LOG] Test finished. Requesting final evaluation.")
                                    ielts_manager.exam_state = "EVALUATION"
                                    ai_text = await ielts_manager.next_turn(user_text)
                                else:
                                    ai_text = await ielts_manager.next_turn(user_text)
                                    if ielts_manager.exam_state == "PART_1": ielts_manager.part_1_question_count += 1
                                    elif ielts_manager.exam_state == "PART_2_FOLLOW_UP": ielts_manager.exam_state = "PART_3"; ielts_manager.part_3_question_count = 1
                            await send_ai_turn(ai_text)
                        else:
                            vad_manager.reset()

    except WebSocketDisconnect: print("[BACKEND LOG] Client disconnected.")
    except Exception as e: print(f"[BACKEND ERROR] Unexpected error: {e}")