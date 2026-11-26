// Client-side Gemini Live API controller for Gather Studio:
// - Real-time Voice & 1 FPS Stage Video Co-Host (gemini-3.8-live)
// - Real-time Speech-to-Speech Translation (gemini-3.5-live-translate-preview)
// - Real-time Streaming Live Captions (gemini-3.5-transcribe-live)

function float32ToBase64Pcm16(float32) {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(int16.buffer);
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  }
  return btoa(bin);
}

function base64Pcm16ToFloat32(base64) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const view = new DataView(bytes.buffer);
  const len = Math.floor(bytes.byteLength / 2);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = view.getInt16(i * 2, true) / 32768;
  }
  return out;
}

export function createGeminiLiveClient({ getCanvas, onStatus, onTranscript, onError }) {
  let ws = null;
  let micStream = null;
  let inputCtx = null;
  let outputCtx = null;
  let processor = null;
  let sourceNode = null;
  let videoTimer = 0;
  let nextStartTime = 0;
  const activeNodes = new Set();
  let running = false;
  let currentMode = 'cohost';

  function stopAudioPlayback() {
    for (const node of activeNodes) {
      try { node.stop(); } catch {}
    }
    activeNodes.clear();
    if (outputCtx) nextStartTime = outputCtx.currentTime;
  }

  function schedulePcmChunk(base64Audio) {
    if (!outputCtx || !base64Audio) return;
    if (outputCtx.state === 'suspended') outputCtx.resume().catch(() => {});
    const samples = base64Pcm16ToFloat32(base64Audio);
    if (!samples.length) return;
    const buffer = outputCtx.createBuffer(1, samples.length, 24000);
    buffer.copyToChannel(samples, 0);
    const src = outputCtx.createBufferSource();
    src.buffer = buffer;
    src.connect(outputCtx.destination);
    const now = outputCtx.currentTime;
    const startAt = Math.max(now + 0.01, nextStartTime);
    src.start(startAt);
    nextStartTime = startAt + buffer.duration;
    activeNodes.add(src);
    src.onended = () => activeNodes.delete(src);
  }

  function captureStageFrameBase64() {
    const canvas = getCanvas?.();
    if (!canvas || !canvas.width || !canvas.height) return '';
    try {
      const tmp = document.createElement('canvas');
      tmp.width = 640;
      tmp.height = 360;
      const g = tmp.getContext('2d');
      g.drawImage(canvas, 0, 0, tmp.width, tmp.height);
      const dataUrl = tmp.toDataURL('image/jpeg', 0.68);
      const idx = dataUrl.indexOf(',');
      return idx >= 0 ? dataUrl.slice(idx + 1) : '';
    } catch {
      return '';
    }
  }

  async function start({ mode = 'cohost', voice = 'Zephyr', lang = 'es', name = 'Sam', title = 'Live Studio', shareVideo = true } = {}) {
    stop();
    currentMode = mode;
    running = true;
    onStatus?.('connecting', mode);

    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      running = false;
      onStatus?.('idle', mode);
      throw new Error('Microphone permission is required for Gemini Live.');
    }

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const qs = new URLSearchParams({ mode, voice, lang, name, title });
    const url = `${proto}//${location.host}/ws/gemini-live?${qs.toString()}`;

    outputCtx = new AudioContext({ sampleRate: 24000 });
    nextStartTime = outputCtx.currentTime;
    inputCtx = new AudioContext({ sampleRate: 16000 });

    ws = new WebSocket(url);

    ws.onopen = () => {
      if (!running) return;
      sourceNode = inputCtx.createMediaStreamSource(micStream);
      processor = inputCtx.createScriptProcessor(4096, 1, 1);
      sourceNode.connect(processor);
      processor.connect(inputCtx.destination);
      processor.onaudioprocess = (ev) => {
        if (!running || !ws || ws.readyState !== WebSocket.OPEN) return;
        const pcm = float32ToBase64Pcm16(ev.inputBuffer.getChannelData(0));
        ws.send(JSON.stringify({ audio: pcm }));
      };

      if (mode === 'cohost' && shareVideo) {
        // Strictly <= 1 FPS JPEG frames per Gemini Live API guidelines
        videoTimer = window.setInterval(() => {
          if (!running || !ws || ws.readyState !== WebSocket.OPEN) return;
          const frame = captureStageFrameBase64();
          if (frame) ws.send(JSON.stringify({ video: frame }));
        }, 1250);
      }
    };

    ws.onmessage = (ev) => {
      let msg = null;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (!msg) return;
      if (msg.type === 'ready') {
        onStatus?.('live', mode, msg.model);
      } else if (msg.type === 'audio' && msg.data) {
        schedulePcmChunk(msg.data);
      } else if (msg.type === 'interrupted') {
        stopAudioPlayback();
      } else if (msg.type === 'interimTranscript' && msg.text) {
        onTranscript?.({ role: 'interim', text: msg.text, mode });
      } else if (msg.type === 'inputTranscript' && msg.text) {
        onTranscript?.({ role: 'user', text: msg.text, mode });
      } else if (msg.type === 'outputTranscript' && msg.text) {
        onTranscript?.({ role: 'assistant', text: msg.text, mode });
      } else if (msg.type === 'error') {
        onError?.(msg.message || 'Gemini Live encountered an error.');
      } else if (msg.type === 'closed') {
        stop();
      }
    };

    ws.onerror = () => {
      onError?.('Gemini Live WebSocket connection failed.');
    };

    ws.onclose = () => {
      if (running) stop();
    };
  }

  function sendText(text) {
    if (!running || !ws || ws.readyState !== WebSocket.OPEN || currentMode !== 'cohost') return false;
    ws.send(JSON.stringify({ text: String(text || '').slice(0, 1000) }));
    return true;
  }

  function stop() {
    running = false;
    if (videoTimer) { clearInterval(videoTimer); videoTimer = 0; }
    stopAudioPlayback();
    try { processor?.disconnect(); } catch {}
    try { sourceNode?.disconnect(); } catch {}
    processor = null;
    sourceNode = null;
    try { micStream?.getTracks().forEach((t) => t.stop()); } catch {}
    micStream = null;
    try { inputCtx?.close(); } catch {}
    try { outputCtx?.close(); } catch {}
    inputCtx = null;
    outputCtx = null;
    if (ws) {
      const sock = ws;
      ws = null;
      try { sock.close(); } catch {}
    }
    onStatus?.('idle', currentMode);
  }

  return {
    start,
    stop,
    sendText,
    get running() { return running; },
    get mode() { return currentMode; },
  };
}
