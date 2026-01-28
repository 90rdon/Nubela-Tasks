export interface SubTask {
  id: string;
  title: string;
  completed: boolean;
}

export interface Task {
  id: string;
  title: string;
  completed: boolean;
  isBreakingDown: boolean;
  subTasks: SubTask[];
  createdAt: number;
}

export interface AudioConfig {
  sampleRate: number;
}

export enum VisualizerMode {
  IDLE = 'IDLE',
  LISTENING = 'LISTENING',
  SPEAKING = 'SPEAKING',
  THINKING = 'THINKING'
}
