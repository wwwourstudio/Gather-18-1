// Server-side Google Gemini integration powered by the official @google/genai SDK.
// Covers:
// - Text/Chat Producer, AI Recap, Stream Kit, Search Grounding & Stage Vision (gemini-4-hydrogen)
// - Audio Transcription / STT (gemini-3.5-transcribe)
// - Studio Text-to-Speech / TTS (gemini-3.8-flash-lite-tts & gemini-3.8-flash-tts)
// - Real-Time Voice & Video Co-Host, Live Captions & Live Speech Translation via WebSocket
//   (gemini-3.8-live, gemini-3.5-transcribe-live, gemini-3.5-live-translate-preview)

const { GoogleGenAI, Modality, Type } = require('@google/genai');
const { WebSocketServer } = require('ws');

const MODELS = {
  text: process.env.GEMINI_TEXT_MODEL || 'gemini-4-hydrogen',
  stt: 'gemini-3.5-transcribe',
  ttsLite: 'gemini-3.8-flash-lite-tts',
  ttsExpressive: 'gemini-3.8-flash-tts',
  liveCohost: 'gemini-3.8-live',
  liveTranscribe: 'gemini-3.5-transcribe-live',
  liveTranslate: 'gemini-3.5-live-translate-preview',
};

const GEMINI_VOICES = ['Kore', 'Zephyr', 'Puck', 'Charon', 'Fenrir'];

function getServerGeminiKey() {
  return String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
}

/** Scrub API keys, OAuth tokens, and query-string secrets from error strings and logs. */
function redactSecrets(input) {
  return String(input ?? '')
    .replace(/\bAIza[0-9A-Za-z_-]{15,}\b/g, '[REDACTED]')
    .replace(/\bsk-(?:ant-|proj-)?[0-9A-Za-z_-]{16,}\b/g, '[REDACTED]')
    .replace(/\bya29\.[0-9A-Za-z._-]{16,}\b/g, '[REDACTED]')
    .replace(/\bghp_[0-9A-Za-z]{20,}\b/g, '[REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, 'Bearer [REDACTED]')
    .replace(/([?&](?:key|api_key|token|access_token)=)[^&\s"'<>]+/gi, '$1[REDACTED]');
}

function createGeminiClient(apiKey) {
  const key = String(apiKey || getServerGeminiKey()).trim();
  if (!key) return null;
  return new GoogleGenAI({
    apiKey: key,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function normalizeVoice(voice) {
  const v = String(voice || '').trim();
  const match = GEMINI_VOICES.find((x) => x.toLowerCase() === v.toLowerCase());
  return match || 'Zephyr';
}

function extractGroundingSources(response) {
  const chunks = response?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  const seen = new Set();
  const sources = [];
  for (const c of chunks) {
    const uri = c?.web?.uri;
    if (!uri || !/^https?:\/\//i.test(uri) || seen.has(uri)) continue;
    seen.add(uri);
    sources.push({
      uri,
      title: String(c?.web?.title || uri.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]).slice(0, 80),
    });
    if (sources.length >= 6) break;
  }
  return sources;
}

/** Generate text with optional Google Search grounding and/or multimodal image frame. */
async function generateText({ apiKey, model, systemInstruction, messages, useSearch = false, responseMimeType, maxOutputTokens, imageDataUrl }) {
  const ai = createGeminiClient(apiKey);
  if (!ai) throw new Error('Gemini API key is not configured on the server.');
  const useModel = String(model || '').trim() || MODELS.text;

  const contents = (Array.isArray(messages) ? messages : [{ role: 'user', text: String(messages || '') }]).map((m) => ({
    role: m.role === 'assistant' || m.role === 'model' ? 'model' : 'user',
    parts: [{ text: String(m.text || '') }],
  }));

  if (imageDataUrl) {
    const match = String(imageDataUrl).match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/i);
    if (match && contents.length) {
      contents[contents.length - 1].parts.unshift({
        inlineData: { mimeType: match[1], data: match[2] },
      });
    }
  }

  const config = {};
  if (systemInstruction) config.systemInstruction = systemInstruction;
  if (maxOutputTokens) config.maxOutputTokens = maxOutputTokens;
  if (responseMimeType && !useSearch) config.responseMimeType = responseMimeType;
  if (useSearch) config.tools = [{ googleSearch: {} }];

  const response = await ai.models.generateContent({
    model: useModel,
    contents,
    config,
  });

  return {
    text: String(response?.text || ''),
    sources: useSearch ? extractGroundingSources(response) : [],
    model: useModel,
  };
}

/** Analyze a live stage screenshot (JPEG/PNG data URL) with Gemini Vision (gemini-4-hydrogen). */
async function analyzeStageFrame({ apiKey, imageDataUrl, prompt, studioContext = '' }) {
  const ai = createGeminiClient(apiKey);
  if (!ai) throw new Error('Gemini API key is not configured on the server.');
  const match = String(imageDataUrl || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) throw new Error('A valid stage image frame is required.');

  const userPrompt = String(prompt || 'Describe what is on the live stage right now and suggest one crisp broadcast improvement or talking point.').slice(0, 1200);
  const systemInstruction = [
    'You are Sam, the live broadcast producer and visual director in gather studio.',
    'Analyze the live stage frame concisely (under 85 words, plain sentences, no markdown headings).',
    'Point out framing, lighting, slide readability, or on-screen details the host can act on immediately.',
    studioContext ? `Studio state: ${String(studioContext).slice(0, 300)}` : '',
  ].filter(Boolean).join('\n');

  const response = await ai.models.generateContent({
    model: MODELS.text,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: match[1], data: match[2] } },
          { text: userPrompt },
        ],
      },
    ],
    config: { systemInstruction, maxOutputTokens: 320 },
  });

  return { text: String(response?.text || '').trim(), model: MODELS.text };
}

/**
 * Evaluate live studio speaker transitions for high engagement using Gemini (gemini-4-hydrogen)
 * with structured JSON output. Used by the studio AI Highlight Agent to decide when to auto-generate
 * a 30-second Smart Highlight clip.
 */
async function evaluateSpeakerTransition({
  apiKey,
  transitions = [],
  activeSpeakers = [],
  transcript = [],
  chatVelocity = 0,
  title = 'Live Studio',
  sensitivity = 'balanced',
}) {
  const ai = createGeminiClient(apiKey);
  if (!ai) {
    const err = new Error('Gemini API key is not configured on the server.');
    err.status = 503;
    throw err;
  }

  const sens = ['high', 'balanced', 'selective'].includes(sensitivity) ? sensitivity : 'balanced';
  const cleanTransitions = (Array.isArray(transitions) ? transitions : []).slice(-8).map((t) => ({
    from: String(t?.from || 'Speaker A').slice(0, 40),
    to: String(t?.to || 'Speaker B').slice(0, 40),
    gapMs: Math.max(0, Math.round(Number(t?.gapMs) || 0)),
    overlap: !!t?.overlap,
    energy: Math.round(Math.max(0, Math.min(1, Number(t?.energy) || 0)) * 100),
  }));
  const cleanSpeakers = (Array.isArray(activeSpeakers) ? activeSpeakers : []).slice(0, 8).map((s) => ({
    name: String(s?.name || 'Speaker').slice(0, 40),
    level: Math.round(Math.max(0, Math.min(1, Number(s?.level) || 0)) * 100),
  }));
  const cleanTranscript = (Array.isArray(transcript) ? transcript : []).slice(-10).map((t) => (
    `${String(t?.speaker || 'Speaker').slice(0, 32)}: ${String(t?.text || '').slice(0, 180)}`
  ));

  const systemInstruction = [
    'You are the autonomous Smart Highlights AI Agent inside gather live broadcast studio.',
    'Monitor speaker transitions, vocal energy, overlapping banter, chat bursts, and recent spoken lines.',
    'Decide whether the latest speaker handoff represents a high-engagement moment worthy of a 30-second highlight clip.',
    `Sensitivity setting: "${sens}".`,
    '- high: clip lively handoffs, quick reactions, or energetic speaker switches (threshold score >= 55).',
    '- balanced: clip clear high-engagement transitions, banter, strong quotes, or chat surges (threshold score >= 68).',
    '- selective: clip only standout debates, punchy reveals, rapid multi-speaker exchanges, or big reactions (threshold score >= 80).',
    'Write a crisp, natural broadcast clip title (<= 48 chars, no hashtags or emojis) and a one-sentence summary (<= 135 chars).',
  ].join('\n');

  const prompt = [
    `Show title: ${String(title || 'Live Studio').slice(0, 80)}`,
    `Recent speaker transitions (most recent last): ${JSON.stringify(cleanTransitions)}`,
    `Active stage speakers: ${JSON.stringify(cleanSpeakers)}`,
    `Chat & reaction bursts in last 30s: ${Math.max(0, Math.round(Number(chatVelocity) || 0))}`,
    cleanTranscript.length ? `Recent spoken lines:\n${cleanTranscript.join('\n')}` : 'Recent spoken lines: (none transcribed yet — judge from speaker transition energy and cadence)',
  ].join('\n');

  const response = await ai.models.generateContent({
    model: MODELS.text,
    contents: prompt,
    config: {
      systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          shouldClip: {
            type: Type.BOOLEAN,
            description: 'True when the speaker transition meets the engagement bar for a 30-second highlight clip.',
          },
          score: {
            type: Type.INTEGER,
            description: 'Engagement score from 0 to 100.',
          },
          title: {
            type: Type.STRING,
            description: 'Short broadcast highlight title, 3 to 6 words, max 48 characters.',
          },
          summary: {
            type: Type.STRING,
            description: 'Concise 1-sentence summary of the speaker handoff moment, max 135 characters.',
          },
          reason: {
            type: Type.STRING,
            description: 'Brief 2-4 word reason such as Rapid handoff, Lively banter, or High-energy turn.',
          },
        },
        required: ['shouldClip', 'score', 'title', 'summary', 'reason'],
      },
    },
  });

  const parsed = JSON.parse(String(response?.text || '{}').trim() || '{}');
  return {
    shouldClip: !!parsed.shouldClip,
    score: Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 0))),
    title: String(parsed.title || 'Speaker Highlight').trim().slice(0, 52),
    summary: String(parsed.summary || 'High-engagement speaker transition captured on stage.').trim().slice(0, 140),
    reason: String(parsed.reason || 'Speaker handoff').trim().slice(0, 40),
    model: MODELS.text,
  };
}

/** Transcribe recorded audio using gemini-3.5-transcribe. */
async function transcribeAudio({ apiKey, mimeType, base64Data }) {
  const ai = createGeminiClient(apiKey);
  if (!ai) throw new Error('Gemini API key is not configured on the server.');
  const response = await ai.models.generateContent({
    model: MODELS.stt,
    contents: {
      parts: [
        { inlineData: { mimeType, data: base64Data } },
        { text: 'Transcribe this spoken audio verbatim. Return only the transcript text.' },
      ],
    },
  });
  return String(response?.text || '').trim().slice(0, 2000);
}

/** Synthesize speech using Gemini 3.8 TTS (returns complete 24kHz mono WAV Buffer). */
async function synthesizeSpeech({ apiKey, text, voice = 'Zephyr', expressive = false }) {
  const ai = createGeminiClient(apiKey);
  if (!ai) throw new Error('Gemini API key is not configured on the server.');
  const input = String(text || '').trim().slice(0, 1500);
  if (!input) throw new Error('Nothing to say.');
  const voiceName = normalizeVoice(voice);
  const model = expressive ? MODELS.ttsExpressive : MODELS.ttsLite;

  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: input,
            speechMetadata: {
              style: expressive
                ? 'Warm, energetic live podcast co-host with natural rhythm and conversational delivery'
                : 'Clear, upbeat, natural live studio co-host',
            },
          },
        ],
      },
    ],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName },
        },
      },
    },
  });

  const base64Audio = response?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) throw new Error('Gemini TTS did not return audio.');
  return {
    buffer: Buffer.from(base64Audio, 'base64'),
    contentType: 'audio/wav',
    model,
    voiceName,
  };
}

/** Create WebSocket bridge for Gemini Live API (Co-Host Voice+Video, Live Captions, Live Speech Translation). */
function createGeminiLiveBridge() {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });

  wss.on('connection', async (clientWs, req) => {
    const u = new URL(req.url || '/', 'http://localhost');
    const mode = ['cohost', 'transcribe', 'translate'].includes(u.searchParams.get('mode'))
      ? u.searchParams.get('mode')
      : 'cohost';
    const voiceName = normalizeVoice(u.searchParams.get('voice') || 'Zephyr');
    const targetLang = String(u.searchParams.get('lang') || 'es').replace(/[^a-zA-Z-]/g, '').slice(0, 12) || 'es';
    const aiName = String(u.searchParams.get('name') || 'Sam').slice(0, 24);
    const showTitle = String(u.searchParams.get('title') || 'Live Studio').slice(0, 80);

    const safeSend = (payload) => {
      try {
        if (clientWs.readyState === 1) clientWs.send(JSON.stringify(payload));
      } catch {}
    };

    const ai = createGeminiClient();
    if (!ai) {
      safeSend({ type: 'error', message: 'Gemini API key is not configured on the server.' });
      clientWs.close();
      return;
    }

    let model = MODELS.liveCohost;
    let config;

    if (mode === 'translate') {
      model = MODELS.liveTranslate;
      // Strict Live Translate contract: AUDIO modality + translationConfig only (no systemInstruction/tools/video)
      config = {
        responseModalities: [Modality.AUDIO],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        translationConfig: {
          targetLanguageCode: targetLang,
          echoTargetLanguage: false,
        },
      };
    } else if (mode === 'transcribe') {
      model = MODELS.liveTranscribe;
      config = {
        responseModalities: [Modality.TEXT],
        inputAudioTranscription: {
          languageCodes: [],
        },
      };
    } else {
      model = MODELS.liveCohost;
      config = {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        systemInstruction: `You are ${aiName}, the live voice and video AI co-host & broadcast producer for "${showTitle}" inside gather studio. Keep spoken answers crisp, warm, natural, and under 25 seconds so you sound like a great co-host on air. When you see live stage video frames, comment naturally on what is on screen when asked.`,
      };
    }

    let closed = false;
    let liveSession = null;

    const sessionPromise = ai.live.connect({
      model,
      config,
      callbacks: {
        onopen: () => {
          safeSend({ type: 'ready', mode, model, voice: voiceName, lang: targetLang });
        },
        onmessage: (message) => {
          if (closed) return;
          const content = message?.serverContent;
          if (!content) return;

          if (content.interimInputTranscription?.text) {
            safeSend({ type: 'interimTranscript', text: content.interimInputTranscription.text });
          }
          if (content.inputTranscription?.text) {
            safeSend({ type: 'inputTranscript', text: content.inputTranscription.text });
          }
          if (content.outputTranscription?.text) {
            safeSend({ type: 'outputTranscript', text: content.outputTranscription.text });
          }
          for (const part of content.modelTurn?.parts || []) {
            if (part?.inlineData?.data) {
              safeSend({ type: 'audio', data: part.inlineData.data });
            } else if (part?.text && mode === 'transcribe') {
              safeSend({ type: 'outputTranscript', text: part.text });
            }
          }
          if (content.interrupted) {
            safeSend({ type: 'interrupted' });
          }
          if (content.turnComplete) {
            safeSend({ type: 'turnComplete' });
          }
        },
        onerror: (err) => {
          safeSend({ type: 'error', message: redactSecrets(err?.message || 'Gemini Live session hit a connection error.') });
        },
        onclose: () => {
          if (!closed) {
            closed = true;
            safeSend({ type: 'closed' });
            try { clientWs.close(); } catch {}
          }
        },
      },
    });

    sessionPromise
      .then((s) => {
        liveSession = s;
        if (closed) {
          try { s.close(); } catch {}
        }
      })
      .catch((err) => {
        safeSend({ type: 'error', message: redactSecrets(err?.message || 'Could not start Gemini Live session.') });
        try { clientWs.close(); } catch {}
      });

    clientWs.on('message', (raw) => {
      let msg = null;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (!msg || closed) return;
      sessionPromise.then((session) => {
        if (!session || closed) return;
        try {
          if (msg.audio && typeof msg.audio === 'string') {
            session.sendRealtimeInput({
              audio: { data: msg.audio, mimeType: 'audio/pcm;rate=16000' },
            });
          } else if (msg.video && typeof msg.video === 'string' && mode === 'cohost') {
            session.sendRealtimeInput({
              video: { data: msg.video, mimeType: 'image/jpeg' },
            });
          } else if (msg.text && typeof msg.text === 'string' && mode === 'cohost') {
            session.sendRealtimeInput({
              text: String(msg.text).slice(0, 1000),
            });
          }
        } catch (e) {
          safeSend({ type: 'error', message: redactSecrets(e?.message || 'Could not forward stream frame to Gemini Live.') });
        }
      }).catch(() => {});
    });

    const cleanup = () => {
      if (closed) return;
      closed = true;
      try { liveSession?.close(); } catch {}
      liveSession = null;
    };
    clientWs.on('close', cleanup);
    clientWs.on('error', cleanup);
  });

  return {
    handleUpgrade(req, socket, head) {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    },
  };
}

module.exports = {
  MODELS,
  GEMINI_VOICES,
  getServerGeminiKey,
  redactSecrets,
  createGeminiClient,
  generateText,
  analyzeStageFrame,
  evaluateSpeakerTransition,
  transcribeAudio,
  synthesizeSpeech,
  createGeminiLiveBridge,
};
