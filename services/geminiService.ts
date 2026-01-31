
import { GoogleGenAI, Type, FunctionDeclaration, Modality, LiveServerMessage } from "@google/genai";
import { createPcmBlob, base64ToBytes, decodeAudioData } from "./audioUtils";
import { checkLocalAiAvailability, runLocalPrompt } from "./localAiService";
import { AiProvider } from "../types";

// --- Cloud Client Factory ---

const getCloudClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey || apiKey === "undefined" || apiKey.trim() === "") {
    return null;
  }
  try {
    return new GoogleGenAI({ apiKey });
  } catch (e) {
    console.error("Visionary Protocol: Failed to initialize cloud core.", e);
    return null;
  }
};

// --- Hybrid Task Breakdown Service ---

/**
 * Robust JSON extractor for AI responses. 
 * Local models often add conversational fluff like "Here is the JSON:" which breaks JSON.parse.
 */
const extractJsonArray = (text: string): string[] => {
  try {
    // 1. Try direct parse
    const json = JSON.parse(text);
    if (Array.isArray(json)) return json.map((i: any) => i.step || i);
    if (json.items) return json.items.map((i: any) => i.step || i);
  } catch (e) {
    // 2. Regex extraction for [ ... ]
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        const json = JSON.parse(match[0]);
        return json.map((i: any) => i.step || i);
      } catch (e2) { /* continue */ }
    }
  }
  // 3. Fallback: Split by newlines and remove numbering
  return text.split('\n')
    .map(line => line.replace(/^[\d-]+\.\s*/, '').trim())
    .filter(line => line.length > 0 && !line.startsWith('{') && !line.startsWith('['));
};

export const breakDownTask = async (
  taskTitle: string,
  existingSteps: string[] = [],
  onStatusUpdate?: (provider: AiProvider, isDownloading: boolean) => void
): Promise<string[]> => {

  const contextStr = existingSteps.length > 0
    ? `Current sub-items: ${existingSteps.join(', ')}. `
    : '';

  const prompt = `Task: "${taskTitle}". ${contextStr} Break this into 3-5 concise, actionable steps. Return strictly a JSON array of objects with a "step" property. Example: [{"step": "Do X"}, {"step": "Do Y"}]`;

  // 1. Try Local AI (Gemini Nano)
  try {
    const localStatus = await checkLocalAiAvailability();

    if (localStatus !== 'no') {
      if (onStatusUpdate) onStatusUpdate('LOCAL_NANO', localStatus === 'after-download');

      console.log(`Visionary: Attempting Local Neural Core (${localStatus})...`);

      const localResponse = await runLocalPrompt(
        "You are a task management assistant. Output valid JSON only.",
        prompt,
        (loaded, total) => {
          console.log(`Downloading Local Model: ${(loaded / total) * 100}%`);
          // We could bubble progress here if needed
        }
      );

      const steps = extractJsonArray(localResponse);
      if (steps.length > 0) return steps;
    }
  } catch (error) {
    console.warn("Visionary: Local Core failed, switching to Cloud Uplink.", error);
  }

  // 2. Fallback to Cloud AI (Gemini Flash)
  if (onStatusUpdate) onStatusUpdate('CLOUD_GEMINI', false);
  const ai = getCloudClient();
  if (!ai) return [];

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `You are the Chief of Staff. Map the path. 
      Break down the objective into 3 to 6 actionable steps. 
      ${contextStr}
      Task: "${taskTitle}"`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              step: { type: Type.STRING }
            }
          }
        }
      }
    });

    const text = response.text;
    if (!text) return [];

    const json = JSON.parse(text);
    return json.map((item: any) => item.step);
  } catch (error) {
    console.error("Error breaking down task (Cloud):", error);
    return [];
  }
};

// --- Live Audio Service (Cloud Only) ---
// Note: Local AI Audio streaming is not yet supported in standard browser APIs.

export interface LiveConnectionCallbacks {
  onOpen: () => void;
  onClose: (isUserClosing: boolean) => void;
  onAudioData: (data: Uint8Array) => void;
  onTranscript: (text: string) => void;
  onVolumeLevel: (volume: number) => void;
  onStatusChange?: (status: 'connecting' | 'connected' | 'error') => void;
  onError: (error: any) => void;
  onToolCall: (name: string, args: any) => Promise<any>;
}

export class LiveSessionManager {
  private sessionPromise: Promise<any> | null = null;
  private inputAudioContext: AudioContext | null = null;
  private outputAudioContext: AudioContext | null = null;
  private inputSource: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private nextStartTime: number = 0;
  private sources: Set<AudioBufferSourceNode> = new Set();
  private callbacks: LiveConnectionCallbacks;
  private isUserClosing: boolean = false;

  constructor(callbacks: LiveConnectionCallbacks) {
    this.callbacks = callbacks;
  }

  async connect() {
    const ai = getCloudClient();
    if (!ai) {
      this.callbacks.onError(new Error("Visionary Protocol Offline."));
      return;
    }

    this.isUserClosing = false;
    this.callbacks.onStatusChange?.('connecting');

    try {
      // Create Contexts - iPhone Safari requires these on user action
      this.inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      this.outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });

      // Explicitly resume for Safari compatibility
      if (this.inputAudioContext.state === 'suspended') await this.inputAudioContext.resume();
      if (this.outputAudioContext.state === 'suspended') await this.outputAudioContext.resume();

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const getTasksTool: FunctionDeclaration = {
        name: 'getTasks',
        parameters: {
          type: Type.OBJECT,
          description: 'Load the current state of the summit/goals.',
          properties: {},
        }
      };

      const addTaskTool: FunctionDeclaration = {
        name: 'addTask',
        parameters: {
          type: Type.OBJECT,
          description: 'Add a new objective or path marker.',
          properties: {
            title: { type: Type.STRING },
            parentKeyword: { type: Type.STRING }
          },
          required: ['title'],
        },
      };

      const markTaskDoneTool: FunctionDeclaration = {
        name: 'markTaskDone',
        parameters: {
          type: Type.OBJECT,
          description: 'Mark a goal as conquered.',
          properties: { keyword: { type: Type.STRING } },
          required: ['keyword']
        }
      };

      const decomposeTaskTool: FunctionDeclaration = {
        name: 'decomposeTask',
        parameters: {
          type: Type.OBJECT,
          description: 'Expand a high-level goal into actionable path markers.',
          properties: { taskTitle: { type: Type.STRING } },
          required: ['taskTitle'],
        },
      };

      this.sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            this.callbacks.onStatusChange?.('connected');
            this.callbacks.onOpen();
            this.startAudioInputStream(stream);
          },
          onmessage: async (message: LiveServerMessage) => {
            this.handleServerMessage(message);
          },
          onclose: () => this.callbacks.onClose(this.isUserClosing),
          onerror: (e) => this.callbacks.onError(e)
        },
        config: {
          responseModalities: [Modality.AUDIO],
          tools: [{ functionDeclarations: [getTasksTool, addTaskTool, markTaskDoneTool, decomposeTaskTool] }],
          systemInstruction: `You are the Visionary Co-Pilot. 
Your user is a high-level thinker who focuses on outcomes, not details. 
You are their Chief of Staff. You anticipate obstacles and handle the breakdown of complex goals.

CORE DIRECTIVE:
- When they mention a goal, suggest mapping the path (decomposeTask).
- Keep conversations brief and momentum-oriented.
- Always check the current status (getTasks) before acting.
- Confirm completions with "Conquered" or "Summit reached" style language.`,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } }
          }
        }
      });
    } catch (err) {
      console.error("Live Session Error:", err);
      this.callbacks.onStatusChange?.('error');
      this.callbacks.onError(err);
    }
  }

  private startAudioInputStream(stream: MediaStream) {
    if (!this.inputAudioContext) return;
    this.inputSource = this.inputAudioContext.createMediaStreamSource(stream);
    this.processor = this.inputAudioContext.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (e) => {
      // Safety: Don't process if context is closed or suspended
      if (!this.inputAudioContext || this.inputAudioContext.state === 'suspended') return;

      const inputData = e.inputBuffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < inputData.length; i++) sum += inputData[i] * inputData[i];
      this.callbacks.onVolumeLevel(Math.sqrt(sum / inputData.length));

      const pcmBlob = createPcmBlob(inputData);
      if (this.sessionPromise) {
        this.sessionPromise.then((session) => {
          try { session.sendRealtimeInput({ media: pcmBlob }); }
          catch (e) { /* connection might be closing */ }
        });
      }
    };
    this.inputSource.connect(this.processor);
    this.processor.connect(this.inputAudioContext.destination);
  }

  private async handleServerMessage(message: LiveServerMessage) {
    const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
    if (base64Audio && this.outputAudioContext) {
      if (this.outputAudioContext.state === 'suspended') await this.outputAudioContext.resume();
      this.nextStartTime = Math.max(this.outputAudioContext.currentTime, this.nextStartTime);
      const audioBuffer = await decodeAudioData(base64ToBytes(base64Audio), this.outputAudioContext, 24000);
      const source = this.outputAudioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.outputAudioContext.destination);
      source.addEventListener('ended', () => this.sources.delete(source));
      source.start(this.nextStartTime);
      this.nextStartTime += audioBuffer.duration;
      this.sources.add(source);
    }
    if (message.toolCall?.functionCalls) {
      for (const fc of message.toolCall.functionCalls) {
        if (!fc.name) continue;
        let result: any = { status: 'ok' };
        try { result = await this.callbacks.onToolCall(fc.name, fc.args); }
        catch (err) { result = { error: (err as Error).message }; }
        if (this.sessionPromise) {
          this.sessionPromise.then(session => {
            session.sendToolResponse({ functionResponses: [{ id: fc.id, name: fc.name!, response: { result } }] });
          });
        }
      }
    }
  }

  async disconnect() {
    this.isUserClosing = true;

    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }

    if (this.inputSource) {
      const stream = this.inputSource.mediaStream;
      stream.getTracks().forEach(track => track.stop());
      this.inputSource.disconnect();
      this.inputSource = null;
    }

    this.sources.forEach(source => {
      try { source.stop(); } catch (e) { }
    });
    this.sources.clear();

    if (this.inputAudioContext) {
      await this.inputAudioContext.close().catch(() => { });
      this.inputAudioContext = null;
    }
    if (this.outputAudioContext) {
      await this.outputAudioContext.close().catch(() => { });
      this.outputAudioContext = null;
    }

    this.sessionPromise = null;
  }
}
