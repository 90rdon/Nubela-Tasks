
export interface TaskItem {
  id: string;
  title: string;
  completed: boolean;
  isBreakingDown: boolean;
  isExpanded: boolean;
  subTasks: TaskItem[];
  createdAt: number;
}

// Keeping names for compatibility where possible
export type SubTask = TaskItem;
export type Task = TaskItem;

export interface AudioConfig {
  sampleRate: number;
}

export enum VisualizerMode {
  IDLE = 'IDLE',
  LISTENING = 'LISTENING',
  SPEAKING = 'SPEAKING',
  THINKING = 'THINKING'
}

export enum VoiceStatus {
  IDLE = 'IDLE',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  RECONNECTING = 'RECONNECTING',
  ERROR = 'ERROR'
}

export type AiProvider = 'LOCAL_NANO' | 'CLOUD_GEMINI' | 'OFFLINE';

export interface AiStatus {
  provider: AiProvider;
  isDownloading: boolean;
  downloadProgress?: number; // 0 to 100
}
