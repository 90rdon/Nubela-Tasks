import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Mic, MicOff, Brain, Check, Trash2, ChevronDown, ChevronRight, Loader2, Play } from 'lucide-react';
import { Task, SubTask, VisualizerMode } from './types';
import { breakDownTask, LiveSessionManager } from './services/geminiService';
import Orb from './components/Orb';

// --- Utility Components ---

const Button = ({ children, onClick, variant = 'primary', className = '', disabled = false, icon: Icon }: any) => {
  const base = "flex items-center justify-center gap-2 px-4 py-2 rounded-xl font-medium transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed";
  const variants = {
    primary: "bg-nebula-600 hover:bg-nebula-500 text-white shadow-lg shadow-nebula-900/50",
    secondary: "bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700",
    danger: "text-red-400 hover:bg-red-500/10",
    ghost: "text-gray-400 hover:text-white hover:bg-white/5",
    voice: "bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/50"
  };
  
  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${variants[variant as keyof typeof variants]} ${className}`}>
      {Icon && <Icon size={18} />}
      {children}
    </button>
  );
};

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [voiceMode, setVoiceMode] = useState<VisualizerMode>(VisualizerMode.IDLE);
  const [audioVolume, setAudioVolume] = useState(0);
  
  // Refs
  const liveSessionRef = useRef<LiveSessionManager | null>(null);
  const tasksRef = useRef<Task[]>([]); // To access latest tasks inside callbacks

  // Sync ref with state
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  // Load from local storage
  useEffect(() => {
    const saved = localStorage.getItem('nebula-tasks');
    if (saved) {
      setTasks(JSON.parse(saved));
    }
  }, []);

  // Save to local storage
  useEffect(() => {
    localStorage.setItem('nebula-tasks', JSON.stringify(tasks));
  }, [tasks]);

  const addTask = useCallback((title: string) => {
    const newTask: Task = {
      id: crypto.randomUUID(),
      title,
      completed: false,
      isBreakingDown: false,
      subTasks: [],
      createdAt: Date.now()
    };
    setTasks(prev => [newTask, ...prev]);
    return newTask;
  }, []);

  const toggleTask = (taskId: string) => {
    setTasks(prev => prev.map(t => 
      t.id === taskId ? { ...t, completed: !t.completed } : t
    ));
  };

  const deleteTask = (taskId: string) => {
    setTasks(prev => prev.filter(t => t.id !== taskId));
  };

  const toggleSubTask = (taskId: string, subTaskId: string) => {
    setTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;
      return {
        ...t,
        subTasks: t.subTasks.map(st => 
          st.id === subTaskId ? { ...st, completed: !st.completed } : st
        )
      };
    }));
  };

  const handleBreakdown = async (taskId: string, title: string): Promise<string[]> => {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, isBreakingDown: true } : t));
    
    const steps = await breakDownTask(title);
    
    setTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;
      return {
        ...t,
        isBreakingDown: false,
        subTasks: steps.map(step => ({
          id: crypto.randomUUID(),
          title: step,
          completed: false
        }))
      };
    }));

    return steps;
  };

  // --- Voice Logic ---

  const toggleVoiceMode = async () => {
    if (isVoiceActive) {
      if (liveSessionRef.current) {
        liveSessionRef.current.disconnect();
        liveSessionRef.current = null;
      }
      setIsVoiceActive(false);
      setVoiceMode(VisualizerMode.IDLE);
    } else {
      setVoiceMode(VisualizerMode.THINKING);
      
      const manager = new LiveSessionManager({
        onOpen: () => {
          setIsVoiceActive(true);
          setVoiceMode(VisualizerMode.LISTENING);
        },
        onClose: () => {
          setIsVoiceActive(false);
          setVoiceMode(VisualizerMode.IDLE);
        },
        onAudioData: () => {},
        onTranscript: () => {},
        onVolumeLevel: (vol) => {
          setAudioVolume(vol);
        },
        onError: (err) => {
          console.error("Voice Error", err);
          setIsVoiceActive(false);
        },
        onToolCall: async (name, args) => {
          if (name === 'getTasks') {
            return tasksRef.current.map(t => ({
              title: t.title,
              subTasksCount: t.subTasks.length,
              completed: t.completed
            }));
          }
          if (name === 'addTask') {
            const task = addTask(args.title);
            return { result: `Added task: ${task.title}` };
          }
          if (name === 'addSubTask') {
            const keyword = args.parentTaskKeyword.toLowerCase();
            const task = tasksRef.current.find(t => t.title.toLowerCase().includes(keyword));
            if (task) {
              const newSubTask: SubTask = {
                id: crypto.randomUUID(),
                title: args.subTaskTitle,
                completed: false
              };
              setTasks(prev => prev.map(t => 
                t.id === task.id ? { ...t, subTasks: [...t.subTasks, newSubTask] } : t
              ));
              return { result: `Added subtask "${args.subTaskTitle}" to "${task.title}".` };
            }
            return { result: `I couldn't find a task matching "${args.parentTaskKeyword}" to add that subtask to.` };
          }
          if (name === 'markTaskDone') {
             const keyword = args.keyword.toLowerCase();
             const taskMatch = tasksRef.current.find(t => t.title.toLowerCase().includes(keyword));
             if (taskMatch) {
                toggleTask(taskMatch.id);
                return { result: `Marked task "${taskMatch.title}" as done.` };
             }
             for (const mainTask of tasksRef.current) {
                const subTaskMatch = mainTask.subTasks.find(st => st.title.toLowerCase().includes(keyword));
                if (subTaskMatch) {
                    toggleSubTask(mainTask.id, subTaskMatch.id);
                    return { result: `Marked subtask "${subTaskMatch.title}" as done.` };
                }
             }
             return { result: `Could not find a task or subtask matching "${args.keyword}".` };
          }
          if (name === 'decomposeTask') {
            const titleToCheck = args.taskTitle.toLowerCase();
            let task = tasksRef.current.find(t => t.title.toLowerCase().includes(titleToCheck));
            
            if (!task) {
              task = addTask(args.taskTitle);
            }

            const steps = await handleBreakdown(task.id, task.title);
            
            return { 
              status: "success",
              task: task.title,
              steps: steps,
              message: `I've updated the breakdown for "${task.title}".`
            };
          }
          if (name === 'renameTask') {
            const keyword = args.keyword.toLowerCase();
            const newTitle = args.newTitle;
            const mainTask = tasksRef.current.find(t => t.title.toLowerCase().includes(keyword));
            if (mainTask) {
              setTasks(prev => prev.map(t => t.id === mainTask.id ? { ...t, title: newTitle } : t));
              return { result: `Renamed task to "${newTitle}".` };
            }
            for (const t of tasksRef.current) {
              const subTask = t.subTasks.find(st => st.title.toLowerCase().includes(keyword));
              if (subTask) {
                setTasks(prev => prev.map(task => {
                  if (task.id !== t.id) return task;
                  return {
                    ...task,
                    subTasks: task.subTasks.map(st => st.id === subTask.id ? { ...st, title: newTitle } : st)
                  };
                }));
                return { result: `Renamed subtask to "${newTitle}".` };
              }
            }
            return { result: `Could not find a task or subtask matching "${args.keyword}" to rename.` };
          }
          if (name === 'deleteTask') {
            const keyword = args.keyword.toLowerCase();
            const mainTask = tasksRef.current.find(t => t.title.toLowerCase().includes(keyword));
            if (mainTask) {
              deleteTask(mainTask.id);
              return { result: `Deleted task "${mainTask.title}".` };
            }
            for (const t of tasksRef.current) {
              const subTask = t.subTasks.find(st => st.title.toLowerCase().includes(keyword));
              if (subTask) {
                setTasks(prev => prev.map(task => {
                  if (task.id !== t.id) return task;
                  return {
                    ...task,
                    subTasks: task.subTasks.filter(st => st.id !== subTask.id)
                  };
                }));
                return { result: `Deleted subtask "${subTask.title}".` };
              }
            }
            return { result: `Could not find a task matching "${args.keyword}" to delete.` };
          }
          return { error: 'Unknown tool' };
        }
      });

      try {
        await manager.connect();
        liveSessionRef.current = manager;
      } catch (e) {
        console.error("Failed to connect voice", e);
        setVoiceMode(VisualizerMode.IDLE);
      }
    }
  };

  return (
    <div className="min-h-screen bg-void text-slate-200 font-sans selection:bg-nebula-500/30">
      <div className="fixed top-0 left-0 w-full h-full overflow-hidden -z-10 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-nebula-900/20 rounded-full blur-[100px] animate-float" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[600px] h-[600px] bg-purple-900/10 rounded-full blur-[120px] animate-pulse-slow" />
      </div>

      <div className="container mx-auto max-w-2xl px-4 py-8 md:py-12">
        <header className="flex items-center justify-between mb-10">
          <div>
            <h1 className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-nebula-200 to-nebula-500 tracking-tight">
              Nebula Task
            </h1>
            <p className="text-slate-500 text-sm mt-1">AI-Enhanced Productivity</p>
          </div>
          <Button 
            variant={isVoiceActive ? "voice" : "secondary"} 
            onClick={toggleVoiceMode}
            className="rounded-full w-12 h-12 !px-0 flex items-center justify-center border-2 border-transparent"
            title="Toggle Voice Mode"
          >
            {isVoiceActive ? <MicOff className="animate-pulse" /> : <Mic />}
          </Button>
        </header>

        {isVoiceActive && (
           <div className="mb-8 flex flex-col items-center justify-center p-6 glass-panel rounded-3xl animate-fade-in border-nebula-500/20 border">
              <Orb mode={voiceMode} volume={audioVolume} />
              <p className="mt-4 text-nebula-300 font-medium tracking-widest text-xs uppercase opacity-80">
                 Nebula Live Active
              </p>
           </div>
        )}

        <div className="mb-8 relative group">
          <input
            type="text"
            value={newTaskTitle}
            onChange={(e) => setNewTaskTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newTaskTitle.trim()) {
                addTask(newTaskTitle);
                setNewTaskTitle('');
              }
            }}
            placeholder="What needs to be done?"
            className="w-full bg-slate-900/50 border border-slate-700/50 rounded-2xl py-4 pl-6 pr-16 text-lg focus:outline-none focus:ring-2 focus:ring-nebula-500/50 focus:border-nebula-500/50 transition-all placeholder:text-slate-600"
          />
          <button 
            onClick={() => {
              if (newTaskTitle.trim()) {
                addTask(newTaskTitle);
                setNewTaskTitle('');
              }
            }}
            className="absolute right-3 top-3 p-2 bg-nebula-600 rounded-xl text-white hover:bg-nebula-500 transition-colors disabled:opacity-0 disabled:scale-90"
            disabled={!newTaskTitle.trim()}
          >
            <Plus size={20} />
          </button>
        </div>

        <div className="space-y-4">
          {tasks.length === 0 && (
            <div className="text-center py-20 text-slate-600 italic">
              No tasks yet. Start typing or ask Nebula.
            </div>
          )}
          
          {tasks.map(task => (
            <div key={task.id} className="group relative glass-panel rounded-2xl p-5 transition-all hover:border-slate-600/50">
              <div className="flex items-start gap-4">
                <button 
                  onClick={() => toggleTask(task.id)}
                  className={`mt-1 flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                    task.completed 
                    ? 'bg-nebula-500 border-nebula-500 text-white' 
                    : 'border-slate-600 hover:border-nebula-400'
                  }`}
                >
                  {task.completed && <Check size={14} strokeWidth={3} />}
                </button>
                
                <div className="flex-1">
                  <h3 className={`text-lg font-medium transition-all ${task.completed ? 'text-slate-500 line-through' : 'text-slate-100'}`}>
                    {task.title}
                  </h3>
                  
                  <div className="mt-3">
                    {task.subTasks.length > 0 ? (
                      <div className="pl-4 border-l-2 border-slate-800 space-y-2 mt-3">
                        {task.subTasks.map(st => (
                          <div key={st.id} className="flex items-center gap-3 text-sm">
                            <button 
                              onClick={() => toggleSubTask(task.id, st.id)}
                              className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                                st.completed ? 'bg-slate-600 border-slate-600' : 'border-slate-700 hover:border-slate-500'
                              }`}
                            >
                              {st.completed && <Check size={10} />}
                            </button>
                            <span className={st.completed ? 'text-slate-600 line-through' : 'text-slate-300'}>
                              {st.title}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      !task.completed && (
                        <button 
                        onClick={() => handleBreakdown(task.id, task.title)}
                        disabled={task.isBreakingDown}
                        className="text-xs font-medium text-nebula-400 flex items-center gap-1.5 hover:text-nebula-300 transition-colors mt-1 disabled:opacity-50"
                      >
                        {task.isBreakingDown ? (
                          <>
                            <Loader2 size={12} className="animate-spin" />
                            Nebula is thinking...
                          </>
                        ) : (
                          <>
                            <Brain size={12} />
                            Break down with AI
                          </>
                        )}
                      </button>
                      )
                    )}
                  </div>
                </div>

                <button 
                  onClick={() => deleteTask(task.id)}
                  className="text-slate-600 hover:text-red-400 p-2 opacity-0 group-hover:opacity-100 transition-all"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}