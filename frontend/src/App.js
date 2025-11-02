import React, { useState, useEffect, useRef } from 'react';
import './App.css';

const TestState = {
  IDLE: 'IDLE',
  AI_SPEAKING: 'AI_SPEAKING',
  LISTENING: 'LISTENING',
  PREP_TIME: 'PREP_TIME',
  PART_2_SPEAKING: 'PART_2_SPEAKING',
  ENDED: 'ENDED',
};

const Timer = ({ remaining, type, onSkip, onFinish }) => {
  const formatTime = (seconds) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  };
  const isPrep = type === 'prep_timer';
  const label = isPrep ? 'Preparation Time:' : 'Speaking Time:';
  return (
    <div className="timer-container">
      <div className="timer-display">
        <strong>{label}</strong> {formatTime(remaining)}
      </div>
      {isPrep ? (
        <button onClick={onSkip} className="timer-button">Skip Prep</button>
      ) : (
        <button onClick={onFinish} className="timer-button">Finish Speaking</button>
      )}
    </div>
  );
};

const EvaluationReport = ({ report }) => {
  if (!report) return null;
  return (
    <div className="evaluation-report">
      <h2>IELTS Speaking Test Evaluation</h2>
      <div className="overall-score-block">
        <h3>Overall Band Score</h3>
        <span>{report.overall_band_score}</span>
      </div>
      <div className="sections-grid">
        {report.sections.map((section, index) => (
          <div key={index} className="evaluation-section">
            <div className="section-header">
              <h3>{section.title}</h3>
              <span className="score-badge">{section.score}</span>
            </div>
            <div className="feedback-grid">
              <div className="strengths">
                <h4>Strengths</h4>
                <ul>
                  {Object.entries(section.strengths).map(([key, value]) => (
                    <li key={key}><strong>{key.replace(/([A-Z])/g, ' $1')}:</strong> {value}</li>
                  ))}
                </ul>
              </div>
              <div className="improvements">
                <h4>Areas for Improvement</h4>
                <ul>
                  {Object.entries(section.improvements).map(([key, value]) => (
                    <li key={key}><strong>{key.replace(/([A-Z])/g, ' $1')}:</strong> {value}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [transcript, setTranscript] = useState([]);
  const [testState, setTestState] = useState(TestState.IDLE);
  const [timer, setTimer] = useState({ type: null, remaining: 0 });
  const [pendingTimer, setPendingTimer] = useState(null);
  const [evaluationReport, setEvaluationReport] = useState(null);

  const ws = useRef(null);
  const audioContext = useRef(null);
  const audioNode = useRef(null);
  const audioStream = useRef(null);
  const audioPlayer = useRef(new Audio());
  const transcriptEndRef = useRef(null);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  const startMicrophone = async () => {
    if (audioContext.current && audioContext.current.state === 'running') return;
    try {
      audioContext.current = new (window.AudioContext || window.webkitAudioContext)();
      await audioContext.current.audioWorklet.addModule('/resampler.js');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, noiseSuppression: true, echoCancellation: true } });
      audioStream.current = stream;
      const source = audioContext.current.createMediaStreamSource(audioStream.current);
      audioNode.current = new AudioWorkletNode(audioContext.current, 'resampler-processor', { processorOptions: { targetSampleRate: 16000 } });
      audioNode.current.port.onmessage = (event) => {
        const pcm16Data = new Int16Array(event.data);
        const base64Audio = btoa(String.fromCharCode.apply(null, new Uint8Array(pcm16Data.buffer)));
        if (ws.current?.readyState === WebSocket.OPEN) {
          ws.current.send(JSON.stringify({ type: 'audio_chunk', data: base64Audio }));
        }
      };
      source.connect(audioNode.current).connect(audioContext.current.destination);
    } catch (err) { console.error("Error accessing microphone:", err); }
  };

  const stopMicrophone = () => {
    if (audioStream.current) audioStream.current.getTracks().forEach(track => track.stop());
    if (audioContext.current && audioContext.current.state !== 'closed') audioContext.current.close();
  };

  // --- EFFECT 1: Handles the WebSocket connection lifecycle ---
  // This runs ONLY ONCE when the component mounts.
  useEffect(() => {
    const backendUrl = 'ws://localhost:8001/';
    ws.current = new WebSocket(backendUrl);
    ws.current.onopen = () => setIsConnected(true);
    ws.current.onclose = () => setIsConnected(false);
    ws.current.onerror = (error) => console.error("WebSocket error:", error);

    ws.current.onmessage = (event) => {
      const message = JSON.parse(event.data);
      switch (message.type) {
        case 'transcript':
          setTranscript(prev => [...prev, { speaker: message.speaker, text: message.data }]);
          if (message.speaker === 'User') {
            setTestState(TestState.AI_SPEAKING);
          }
          if (message.start_timer_on_finish) {
            setPendingTimer(message.start_timer_on_finish);
          }
          break;
        case 'audio':
          const audioSrc = "data:audio/wav;base64," + message.data;
          audioPlayer.current.src = audioSrc;
          audioPlayer.current.play();
          break;
        case 'timer_start':
          setTimer({ type: message.timer_type, remaining: message.duration });
          if (message.timer_type === 'prep_timer') setTestState(TestState.PREP_TIME);
          else if (message.timer_type === 'speak_timer') setTestState(TestState.PART_2_SPEAKING);
          break;
        case 'timer_update':
          setTimer(prev => ({ ...prev, remaining: message.remaining }));
          break;
        case 'timer_end':
          setTimer({ type: null, remaining: 0 });
          setTestState(TestState.AI_SPEAKING);
          break;
        case 'force_stop_listening':
          stopMicrophone();
          break;
        case 'final_evaluation':
          setEvaluationReport(message.data);
          setTestState(TestState.ENDED);
          stopMicrophone();
          break;
        default:
          break;
      }
    };

    // This cleanup function will now only run once when the component unmounts.
    return () => ws.current?.close();
  }, []); // The empty array [] is the key to a stable connection.

  // --- EFFECT 2: Handles events that depend on state changes ---
  useEffect(() => {
    const player = audioPlayer.current;
    const handleAudioEnd = () => {
      if (pendingTimer) {
        if (ws.current?.readyState === WebSocket.OPEN) {
          ws.current.send(JSON.stringify({ type: 'tts_finished_start_timer', timer_type: pendingTimer }));
        }
        setPendingTimer(null);
      } else if (testState === TestState.AI_SPEAKING) {
        setTestState(TestState.LISTENING);
      }
    };

    player.addEventListener('ended', handleAudioEnd);
    return () => {
      player.removeEventListener('ended', handleAudioEnd);
    };
  }, [testState, pendingTimer]);

  // --- EFFECT 3: Manages the microphone based on the current test state ---
  useEffect(() => {
    if (testState === TestState.LISTENING || testState === TestState.PART_2_SPEAKING) {
      startMicrophone();
    } else {
      stopMicrophone();
    }
  }, [testState]);

  const handleStartTest = () => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: 'start_test' }));
      setTestState(TestState.AI_SPEAKING);
    }
  };

  const handleSkipPrep = () => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: 'skip_prep_timer' }));
      setTimer({ type: null, remaining: 0 });
      setTestState(TestState.AI_SPEAKING);
    }
  };

  const handleFinishSpeaking = () => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: 'finish_speaking' }));
      setTimer({ type: null, remaining: 0 });
      setTestState(TestState.AI_SPEAKING);
    }
  };

  const handleRestart = () => {
    window.location.reload();
  };

  const renderButton = () => {
    if (timer.type) {
      return <Timer remaining={timer.remaining} type={timer.type} onSkip={handleSkipPrep} onFinish={handleFinishSpeaking} />;
    }
    switch (testState) {
      case TestState.IDLE:
        return <button onClick={handleStartTest} disabled={!isConnected}>Start Test</button>;
      case TestState.AI_SPEAKING:
        return <button disabled>Examiner Speaking...</button>;
      case TestState.LISTENING:
        return <button className="listening">Listening...</button>;
      default:
        return null;
    }
  };

  return (
    <div className="App">
      <div className="container">
        <header className="header">
          <h1>IELTS Speaking Agent</h1>
          <div className="status">
            <span className={`status-indicator ${isConnected ? 'connected' : ''}`}></span>
            {isConnected ? 'Connected' : 'Disconnected'}
          </div>
        </header>
        
        {testState === TestState.ENDED && evaluationReport ? (
          <>
            <EvaluationReport report={evaluationReport} />
            <footer className="footer">
              <button onClick={handleRestart} className="restart-button">
                Take the Test Again
              </button>
            </footer>
          </>
        ) : (
          <>
            <div className="transcript-container">
              {transcript.map((entry, index) => (
                <div key={index} className={`message ${entry.speaker.toLowerCase()}`}>
                  <strong>{entry.speaker}:</strong> {entry.text}
                </div>
              ))}
              <div ref={transcriptEndRef} />
            </div>
            <footer className="footer">
              {renderButton()}
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

export default App;