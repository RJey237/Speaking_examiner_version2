// public/resampler.js

class ResamplerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetSampleRate = options.processorOptions.targetSampleRate;
    
    // --- BUFFERING LOGIC ---
    // The VAD model works best with chunks of 30ms, 60ms, or 90ms.
    // 30ms at 16kHz is 480 samples. We'll use a slightly larger buffer size for safety.
    this.chunkSize = 512; 
    this.buffer = new Int16Array(0);
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input.length > 0) {
      const inputData = input[0]; // Get the first channel
      const downsampleRatio = sampleRate / this.targetSampleRate;
      
      const outputLength = Math.floor(inputData.length / downsampleRatio);
      const resampledData = new Int16Array(outputLength);

      for (let i = 0; i < outputLength; i++) {
        const inputIndex = Math.round(i * downsampleRatio);
        resampledData[i] = inputData[inputIndex] * 32767;
      }

      // --- BUFFERING LOGIC ---
      // 1. Add the new resampled data to our main buffer.
      const newBuffer = new Int16Array(this.buffer.length + resampledData.length);
      newBuffer.set(this.buffer);
      newBuffer.set(resampledData, this.buffer.length);
      this.buffer = newBuffer;

      // 2. While the buffer has enough data for a full chunk, send it.
      while (this.buffer.length >= this.chunkSize) {
        const chunk = this.buffer.slice(0, this.chunkSize);
        
        // Post the complete chunk back to the main thread.
        // We need to copy the buffer before transferring it.
        this.port.postMessage(chunk.buffer.slice(0));

        // 3. Remove the sent chunk from the start of the buffer.
        this.buffer = this.buffer.slice(this.chunkSize);
      }
    }
    return true; // Keep the processor alive
  }
}

registerProcessor('resampler-processor', ResamplerProcessor);