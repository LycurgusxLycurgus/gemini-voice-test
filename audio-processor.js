// audio-processor.js
class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
  }

  process(inputs, outputs, parameters) {
    // We expect a single mono input channel.
    const inputChannel = inputs[0][0];

    // Post the raw Float32Array audio data back to the main thread for processing.
    // We only post a message if there's actual audio data to avoid empty messages.
    if (inputChannel && inputChannel.length > 0) {
      this.port.postMessage(inputChannel);
    }

    // Return true to keep the processor alive.
    return true;
  }
}

registerProcessor('audio-processor', AudioProcessor);