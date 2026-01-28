import { GoogleGenAI, Type, FunctionDeclaration, Modality, LiveServerMessage } from "@google/genai";
import { createPcmBlob, base64ToBytes, decodeAudioData } from "./audioUtils";

// Initialize Gemini Client
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// --- Task Breakdown Service ---

export const breakDownTask = async (taskTitle: string): Promise<string[]> => {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Break down the following task into 3 to 6 smaller, concrete, actionable steps. Keep them concise. Task: "${taskTitle}"`,
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
    console.error("Error breaking down task:", error);
    return [];
  }
};

// --- Live Audio Service ---

interface LiveConnectionCallbacks {
  onOpen: () => void;
  onClose: () => void;
  onAudioData: (buffer: AudioBuffer) => void;
  onTranscript: (user: string, model: string) => void;
  onToolCall: (fnName: string, args: any) => Promise<any>;
  onError: (error: any) => void;
  onVolumeLevel: (level: number) => void; // For visualization
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

  constructor(callbacks: LiveConnectionCallbacks) {
    this.callbacks = callbacks;
  }

  async connect() {
    this.inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    this.outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    const addTaskTool: FunctionDeclaration = {
      name: 'addTask',
      parameters: {
        type: Type.OBJECT,
        description: 'Add a new main todo task to the user\'s list.',
        properties: {
          title: {
            type: Type.STRING,
            description: 'The content/title of the task.',
          },
        },
        required: ['title'],
      },
    };

    const addSubTaskTool: FunctionDeclaration = {
      name: 'addSubTask',
      parameters: {
        type: Type.OBJECT,
        description: 'Add a specific subtask to an existing main task.',
        properties: {
          parentTaskKeyword: {
            type: Type.STRING,
            description: 'A keyword or title of the main task this subtask belongs to.',
          },
          subTaskTitle: {
            type: Type.STRING,
            description: 'The title of the subtask to add.',
          },
        },
        required: ['parentTaskKeyword', 'subTaskTitle'],
      },
    };

    const markTaskDoneTool: FunctionDeclaration = {
      name: 'markTaskDone',
      parameters: {
        type: Type.OBJECT,
        description: 'Mark a task or a subtask as completed by matching its title or keyword.',
        properties: {
          keyword: {
             type: Type.STRING, 
             description: 'A keyword to find the task or subtask to complete.' 
          }
        },
        required: ['keyword']
      }
    };

    const decomposeTaskTool: FunctionDeclaration = {
      name: 'decomposeTask',
      parameters: {
        type: Type.OBJECT,
        description: 'Breaks down a task into smaller subtasks automatically using AI. You MUST call this when the user asks for a breakdown or help planning.',
        properties: {
          taskTitle: {
            type: Type.STRING,
            description: 'The title of the task to break down.',
          },
        },
        required: ['taskTitle'],
      },
    };

    const renameTaskTool: FunctionDeclaration = {
      name: 'renameTask',
      parameters: {
        type: Type.OBJECT,
        description: 'Rename an existing task or subtask. You MUST verbally confirm with the user before calling this tool.',
        properties: {
          keyword: {
            type: Type.STRING,
            description: 'The current name or keyword of the task/subtask to rename.',
          },
          newTitle: {
            type: Type.STRING,
            description: 'The new title for the task/subtask.',
          }
        },
        required: ['keyword', 'newTitle']
      }
    };

    const deleteTaskTool: FunctionDeclaration = {
      name: 'deleteTask',
      parameters: {
        type: Type.OBJECT,
        description: 'Delete/Remove a task or subtask from the list. You MUST verbally confirm with the user before calling this tool.',
        properties: {
          keyword: {
            type: Type.STRING,
            description: 'The name or keyword of the task/subtask to delete.',
          }
        },
        required: ['keyword']
      }
    };

    this.sessionPromise = ai.live.connect({
      model: 'gemini-2.5-flash-native-audio-preview-12-2025',
      callbacks: {
        onopen: () => {
          this.callbacks.onOpen();
          this.startAudioInputStream(stream);
        },
        onmessage: async (message: LiveServerMessage) => {
          this.handleServerMessage(message);
        },
        onclose: () => {
          this.callbacks.onClose();
        },
        onerror: (e) => {
          this.callbacks.onError(e);
        }
      },
      config: {
        responseModalities: [Modality.AUDIO],
        tools: [{ functionDeclarations: [addTaskTool, addSubTaskTool, markTaskDoneTool, decomposeTaskTool, renameTaskTool, deleteTaskTool] }],
        systemInstruction: `You are Nebula, a futuristic productivity AI.
SAFETY RULES:
1. For DELETING or RENAMING tasks/subtasks, you MUST ask the user for verbal confirmation (e.g., "Are you sure you want to delete 'Task Name'?") and only call the tool once they say yes.
2. You do NOT need to ask for confirmation for adding tasks, adding subtasks, marking tasks as done, or decomposing tasks.
3. When a user asks for a breakdown, use 'decomposeTask'.
4. If a user wants to change a name, use 'renameTask' after confirmation.
5. If a user wants to remove something, use 'deleteTask' after confirmation.`,
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } }
        }
      }
    });
  }

  private startAudioInputStream(stream: MediaStream) {
    if (!this.inputAudioContext) return;

    this.inputSource = this.inputAudioContext.createMediaStreamSource(stream);
    this.processor = this.inputAudioContext.createScriptProcessor(4096, 1, 1);

    this.processor.onaudioprocess = (e) => {
      const inputData = e.inputBuffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < inputData.length; i++) {
        sum += inputData[i] * inputData[i];
      }
      const rms = Math.sqrt(sum / inputData.length);
      this.callbacks.onVolumeLevel(rms);

      const pcmBlob = createPcmBlob(inputData);
      
      if (this.sessionPromise) {
        this.sessionPromise.then((session) => {
          session.sendRealtimeInput({ media: pcmBlob });
        });
      }
    };

    this.inputSource.connect(this.processor);
    this.processor.connect(this.inputAudioContext.destination);
  }

  private async handleServerMessage(message: LiveServerMessage) {
    const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
    if (base64Audio && this.outputAudioContext) {
       this.callbacks.onVolumeLevel(0.5);
       this.nextStartTime = Math.max(this.outputAudioContext.currentTime, this.nextStartTime);
       const audioBuffer = await decodeAudioData(base64ToBytes(base64Audio), this.outputAudioContext, 24000);
       const source = this.outputAudioContext.createBufferSource();
       source.buffer = audioBuffer;
       source.connect(this.outputAudioContext.destination);
       source.addEventListener('ended', () => {
         this.sources.delete(source);
         this.callbacks.onVolumeLevel(0);
       });
       source.start(this.nextStartTime);
       this.nextStartTime += audioBuffer.duration;
       this.sources.add(source);
    }

    if (message.serverContent?.interrupted) {
      this.stopAllSources();
    }

    if (message.toolCall) {
      for (const fc of message.toolCall.functionCalls) {
        let result: any = { status: 'ok' };
        try {
          result = await this.callbacks.onToolCall(fc.name, fc.args);
        } catch (err) {
          result = { error: (err as Error).message };
        }
        if (this.sessionPromise) {
          this.sessionPromise.then(session => {
            session.sendToolResponse({
              functionResponses: {
                id: fc.id,
                name: fc.name,
                response: { result }
              }
            });
          });
        }
      }
    }
  }

  private stopAllSources() {
    for (const source of this.sources) {
      source.stop();
    }
    this.sources.clear();
    this.nextStartTime = 0;
  }

  disconnect() {
    if (this.processor) {
      this.processor.disconnect();
      this.processor.onaudioprocess = null;
    }
    if (this.inputSource) {
      this.inputSource.disconnect();
    }
    if (this.inputAudioContext) {
      this.inputAudioContext.close();
    }
    if (this.outputAudioContext) {
      this.outputAudioContext.close();
    }
  }
}