
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { 
  Plus, Mic, MicOff, Brain, Check, Trash2, ChevronDown, 
  ChevronRight, Loader2, Maximize2, Minimize2, ChevronLeft,
  X, Sparkles, AlertCircle, RefreshCw, ShieldAlert, Cpu, CloudLightning
} from 'lucide-react';
import { TaskItem, VisualizerMode, VoiceStatus, AiProvider } from './types';
import { breakDownTask, LiveSessionManager } from './services/geminiService';
import Orb from './components/Orb';

// --- Utility Functions for Tree Management ---

const findInTree = (items: TaskItem[], id: string): TaskItem | null => {
  for (const item of items) {
    if (item.id === id) return item;
    const found = findInTree(item.subTasks, id);
    if (found) return found;
  }
  return null;
};

const findByKeyword = (items: TaskItem[], keyword: string): TaskItem | null => {
  const kw = keyword.toLowerCase();
  for (const item of items) {
    if (item.title.toLowerCase().includes(kw)) return item;
    const found = findByKeyword(item.subTasks, keyword);
    if (found) return found;
  }
  return null;
};

const updateInTree = (items: TaskItem[], id: string, updater: (item: TaskItem) => TaskItem): TaskItem[] => {
  return items.map(item => {
    if (item.id === id) return updater(item);
    return { ...item, subTasks: updateInTree(item.subTasks, id, updater) };
  });
};

const removeFromTree = (items: TaskItem[], id: string): TaskItem[] => {
  return items
    .filter(item => item.id !== id)
    .map(item => ({ ...item, subTasks: removeFromTree(item.subTasks, id) }));
};

const getPathToItem = (items: TaskItem[], id: string, path: TaskItem[] = []): TaskItem[] | null => {
  for (const item of items) {
    const currentPath = [...path, item];
    if (item.id === id) return currentPath;
    const foundPath = getPathToItem(item.subTasks, id, currentPath);
    if (foundPath) return foundPath;
  }
  return null;
};

// --- Sub-components ---

const Button = ({ children, onClick, variant = 'primary', className = '', disabled = false, icon: Icon }: any) => {
  const base = "flex items-center justify-center gap-2 px-4 py-2 rounded-xl font-medium transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation";
  const variants = {
    primary: "bg-nebula-600 hover:bg-nebula-500 text-white shadow-lg shadow-nebula-900/40",
    secondary: "bg-slate-800/50 hover:bg-slate-700/50 text-slate-200 border border-slate-700/50 backdrop-blur-md",
    danger: "text-red-400 hover:bg-red-500/10",
    ghost: "text-slate-400 hover:text-white hover:bg-white/5",
    voice: "bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/50"
  };
  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${variants[variant as keyof typeof variants]} ${className}`}>
      {Icon && <Icon size={18} />}
      {children}
    </button>
  );
};

interface TaskNodeProps {
  item: TaskItem;
  depth: number;
  editingId: string | null;
  editValue: string;
  focusedId: string | null;
  setEditValue: (val: string) => void;
  saveEdit: () => void;
  startEditing: (item: TaskItem) => void;
  toggleComplete: (id: string) => void;
  setFocusedId: (id: string | null) => void;
  handleBreakdownNode: (id: string) => void;
  deleteItem: (id: string) => void;
  addItem: (title: string, parentId?: string) => TaskItem;
  setTasks: React.Dispatch<React.SetStateAction<TaskItem[]>>;
  isAiDisabled: boolean;
  activeProvider: AiProvider | null;
}

const TaskNode: React.FC<TaskNodeProps> = ({ 
  item, depth, editingId, editValue, focusedId, setEditValue, saveEdit,
  startEditing, toggleComplete, setFocusedId, handleBreakdownNode, deleteItem, addItem, setTasks, isAiDisabled, activeProvider
}) => {
  const isEditing = editingId === item.id;
  const isFocused = focusedId === item.id;
  const hasChildren = item.subTasks.length > 0;

  return (
    <div className={`mt-3 ${depth > 0 ? 'ml-4 md:ml-6 border-l border-slate-700/50 pl-4' : ''}`}>
      <div 
        className={`group flex items-start gap-3 p-4 glass-panel rounded-2xl transition-all duration-300 ${isFocused ? 'ring-2 ring-nebula-500/50 shadow-2xl shadow-nebula-500/10' : 'hover:border-slate-500/40 shadow-lg'}`}
        onDoubleClick={(e) => { e.stopPropagation(); startEditing(item); }}
        onClick={(e) => { 
          if (e.detail === 1) { 
            setTasks(prev => updateInTree(prev, item.id, it => ({ ...it, isExpanded: !it.isExpanded })));
          }
        }}
      >
        <button 
          onClick={(e) => { e.stopPropagation(); toggleComplete(item.id); }}
          className={`mt-0.5 w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${item.completed ? 'bg-nebula-500 border-nebula-500 text-white shadow-nebula-500/50' : 'border-slate-600 hover:border-nebula-400'}`}
        >
          {item.completed && <Check size={14} strokeWidth={3} />}
        </button>

        <div className="flex-1 min-w-0 flex flex-col pt-0.5">
          <div className="flex items-center gap-2">
            {isEditing ? (
              <input 
                autoFocus
                className="bg-slate-900/80 text-slate-100 border border-nebula-500 rounded-lg px-2 py-0.5 outline-none w-full"
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                onBlur={saveEdit}
                onKeyDown={e => e.key === 'Enter' && saveEdit()}
                onClick={e => e.stopPropagation()}
              />
            ) : (
              <span className={`text-base md:text-lg font-medium transition-all truncate ${item.completed ? 'line-through text-slate-500 italic' : 'text-slate-100'}`}>
                {item.title}
              </span>
            )}
            {hasChildren && (
              <div className="text-slate-500">
                {item.isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
              </div>
            )}
          </div>
          {!item.isExpanded && hasChildren && (
            <span className="text-[10px] text-nebula-400 font-medium mt-1 uppercase tracking-tighter opacity-80">
              {item.subTasks.length} nested path markers
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 md:opacity-0 group-hover:opacity-100 transition-opacity">
          <button 
            onClick={(e) => { e.stopPropagation(); setFocusedId(isFocused ? null : item.id); }}
            className={`p-2 rounded-xl hover:bg-white/10 transition-colors ${isFocused ? 'text-nebula-400' : 'text-slate-500 hover:text-nebula-300'}`}
            title={isFocused ? "Broaden View" : "Focus on this objective"}
          >
            {isFocused ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
          {!isAiDisabled && (
            <button 
              onClick={(e) => { e.stopPropagation(); handleBreakdownNode(item.id); }}
              className="p-2 rounded-xl hover:bg-white/10 text-slate-500 hover:text-nebula-400 transition-colors"
              title="Reveal Path"
            >
              <Brain size={18} />
            </button>
          )}
          <button 
            onClick={(e) => { e.stopPropagation(); deleteItem(item.id); }}
            className="p-2 rounded-xl hover:bg-white/10 text-slate-500 hover:text-red-400 transition-colors"
          >
            <Trash2 size={18} />
          </button>
        </div>
      </div>

      {item.isExpanded && (
        <div className="animate-fade-in">
          {!item.completed && (
            <div className="mt-3 ml-4 md:ml-6 pl-4 flex items-center gap-3 group/add">
              <Plus size={10} className="text-slate-700" />
              <input 
                placeholder="Add to the vision..."
                className="bg-transparent text-sm text-slate-400 focus:text-slate-200 outline-none w-full placeholder:text-slate-700"
                onKeyDown={e => {
                  if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                    addItem(e.currentTarget.value.trim(), item.id);
                    e.currentTarget.value = '';
                  }
                }}
              />
            </div>
          )}
          
          {item.isBreakingDown ? (
            <div className="flex items-center gap-3 py-4 px-8 text-xs text-nebula-300 font-medium">
              <Loader2 size={14} className="animate-spin text-nebula-500" /> 
              <span>
                {activeProvider === 'LOCAL_NANO' ? "Neural Core (Local) Processing..." : "Aligning Path via Cloud..."}
              </span>
            </div>
          ) : (
            item.subTasks.map(sub => (
              <TaskNode 
                key={sub.id} 
                item={sub} 
                depth={depth + 1} 
                editingId={editingId} 
                editValue={editValue} 
                focusedId={focusedId} 
                setEditValue={setEditValue} 
                saveEdit={saveEdit} 
                startEditing={startEditing} 
                toggleComplete={toggleComplete} 
                setFocusedId={setFocusedId} 
                handleBreakdownNode={handleBreakdownNode} 
                deleteItem={deleteItem} 
                addItem={addItem} 
                setTasks={setTasks}
                isAiDisabled={isAiDisabled}
                activeProvider={activeProvider}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
};

// --- Main App Component ---

export default function App() {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [voiceMode, setVoiceMode] = useState<VisualizerMode>(VisualizerMode.IDLE);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>(VoiceStatus.IDLE);
  const [audioVolume, setAudioVolume] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [toast, setToast] = useState<{ message: string, type: 'error' | 'info' | 'success' } | null>(null);
  
  // Track which AI is doing the work
  const [lastUsedProvider, setLastUsedProvider] = useState<AiProvider | null>(null);
  const [isModelDownloading, setIsModelDownloading] = useState(false);
  
  const tasksRef = useRef<TaskItem[]>([]);
  const liveSessionRef = useRef<LiveSessionManager | null>(null);

  // Safety check for API Key to prevent white-screen crashes
  const isAiDisabled = useMemo(() => {
    const key = process.env.API_KEY;
    return !key || key === "undefined" || key.trim() === "";
  }, []);

  const focusedItem = useMemo(() => focusedId ? findInTree(tasks, focusedId) : null, [tasks, focusedId]);
  const breadcrumbs = useMemo(() => focusedId ? getPathToItem(tasks, focusedId) : null, [tasks, focusedId]);
  const displayItems = useMemo(() => focusedId ? (focusedItem?.subTasks || []) : tasks, [tasks, focusedId, focusedItem]);

  useEffect(() => { tasksRef.current = tasks; }, [tasks]);

  useEffect(() => {
    const saved = localStorage.getItem('visionary-tasks-v1');
    if (saved) {
      try { setTasks(JSON.parse(saved)); } 
      catch (e) { console.error("Failed to load saved tasks:", e); }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('visionary-tasks-v1', JSON.stringify(tasks));
  }, [tasks]);

  const showToast = useCallback((message: string, type: 'error' | 'info' | 'success' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  }, []);

  const addItem = useCallback((title: string, parentId?: string) => {
    const newItem: TaskItem = {
      id: crypto.randomUUID(),
      title,
      completed: false,
      isBreakingDown: false,
      isExpanded: true,
      subTasks: [],
      createdAt: Date.now()
    };
    if (parentId) {
      setTasks(prev => updateInTree(prev, parentId, item => ({
        ...item, subTasks: [...item.subTasks, newItem], isExpanded: true
      })));
    } else {
      setTasks(prev => [newItem, ...prev]);
    }
    return newItem;
  }, []);

  const toggleComplete = useCallback((id: string) => {
    setTasks(prev => updateInTree(prev, id, item => ({ ...item, completed: !item.completed })));
  }, []);

  const deleteItem = useCallback((id: string) => {
    setTasks(prev => removeFromTree(prev, id));
    if (focusedId === id) setFocusedId(null);
  }, [focusedId]);

  const startEditing = useCallback((item: TaskItem) => {
    setEditingId(item.id);
    setEditValue(item.title);
  }, []);

  const saveEdit = useCallback(() => {
    if (editingId) {
      setTasks(prev => updateInTree(prev, editingId, item => ({ ...item, title: editValue })));
      setEditingId(null);
    }
  }, [editingId, editValue]);

  const handleBreakdownNode = useCallback(async (id: string) => {
    // If we have local AI, we can proceed even without an API Key.
    // If no local AI and no API Key, then fail.
    // The breakDownTask function handles the fallback logic internally.
    
    const target = findInTree(tasksRef.current, id);
    if (!target) return;
    setTasks(prev => updateInTree(prev, id, item => ({ ...item, isBreakingDown: true })));
    
    // Pass callback to update UI about who is working
    const steps = await breakDownTask(
        target.title, 
        target.subTasks.map(s => s.title),
        (provider, isDownloading) => {
            setLastUsedProvider(provider);
            setIsModelDownloading(isDownloading);
            if (isDownloading) showToast("Downloading Local AI Model...", "info");
        }
    );
    
    setTasks(prev => updateInTree(prev, id, item => ({
      ...item,
      isBreakingDown: false,
      isExpanded: true,
      subTasks: steps.map(s => ({
        id: crypto.randomUUID(), title: s, completed: false, isBreakingDown: false, isExpanded: true, subTasks: [], createdAt: Date.now()
      }))
    })));
    
    setIsModelDownloading(false);
  }, [showToast]);

  const toggleVoiceMode = async () => {
    if (isAiDisabled) {
      showToast("Voice core requires a valid API Protocol.", "error");
      return;
    }
    if (isVoiceActive || voiceStatus !== VoiceStatus.IDLE) {
      liveSessionRef.current?.disconnect();
      liveSessionRef.current = null;
      setIsVoiceActive(false);
      setVoiceMode(VisualizerMode.IDLE);
      setVoiceStatus(VoiceStatus.IDLE);
    } else {
      setVoiceStatus(VoiceStatus.CONNECTING);
      setVoiceMode(VisualizerMode.THINKING);
      // Voice always uses Cloud for now
      setLastUsedProvider('CLOUD_GEMINI'); 
      const manager = new LiveSessionManager({
        onOpen: () => { 
          setIsVoiceActive(true); 
          setVoiceMode(VisualizerMode.LISTENING);
          setVoiceStatus(VoiceStatus.CONNECTED);
          showToast("Visionary Aligned.", "success");
        },
        onClose: () => { setIsVoiceActive(false); setVoiceStatus(VoiceStatus.IDLE); },
        onAudioData: () => {},
        onTranscript: () => {},
        onVolumeLevel: setAudioVolume,
        onStatusChange: (status) => {
          if (status === 'connecting') setVoiceStatus(VoiceStatus.CONNECTING);
          if (status === 'connected') setVoiceStatus(VoiceStatus.CONNECTED);
        },
        onError: (err) => { 
          showToast("Core Link Failure.", "error");
          setVoiceStatus(VoiceStatus.ERROR);
          setTimeout(() => setVoiceStatus(VoiceStatus.IDLE), 3000);
        },
        onToolCall: async (name, args) => {
          if (name === 'getTasks') return tasksRef.current;
          if (name === 'addTask') {
            const parent = args.parentKeyword ? findByKeyword(tasksRef.current, args.parentKeyword) : null;
            addItem(args.title, parent?.id);
            return { status: 'added' };
          }
          if (name === 'markTaskDone') {
            const match = findByKeyword(tasksRef.current, args.keyword);
            if (match) toggleComplete(match.id);
            return { status: 'completed' };
          }
          if (name === 'decomposeTask') {
            const match = findByKeyword(tasksRef.current, args.taskTitle);
            if (match) handleBreakdownNode(match.id);
            return { status: 'vision_expanded' };
          }
          return { error: 'Unknown tool' };
        }
      });
      await manager.connect();
      liveSessionRef.current = manager;
    }
  };

  return (
    <div className="min-h-screen bg-void text-slate-200 font-sans p-4 md:p-8">
      {/* Dynamic Background */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[80vw] h-[80vw] bg-nebula-900/10 rounded-full blur-[120px]" />
      </div>

      {/* Intelligence Source Indicator */}
      <div className="fixed top-4 right-4 md:right-8 z-20 flex gap-2">
         {lastUsedProvider === 'LOCAL_NANO' && (
             <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 text-emerald-400 text-xs font-bold uppercase tracking-wider ${isModelDownloading ? 'animate-pulse' : ''}`}>
                 <Cpu size={14} /> 
                 {isModelDownloading ? "Acquiring Neural Core..." : "Local Neural Core"}
             </div>
         )}
         {lastUsedProvider === 'CLOUD_GEMINI' && (
             <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-nebula-500/20 bg-nebula-500/10 text-nebula-400 text-xs font-bold uppercase tracking-wider">
                 <CloudLightning size={14} /> Cloud Uplink
             </div>
         )}
      </div>

      {/* API Protocol Guard Banner */}
      {isAiDisabled && !lastUsedProvider && (
        <div className="container mx-auto max-w-3xl mb-6">
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 flex items-center gap-4 text-amber-200 shadow-lg">
            <ShieldAlert className="flex-shrink-0" />
            <div className="text-sm">
              <p className="font-bold">Visionary Offline</p>
              <p className="opacity-80">Intelligence Protocol not found. Voice disabled. Local Neural Core may attempt breakdown if available.</p>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-2xl shadow-2xl backdrop-blur-xl border flex items-center gap-3 bg-slate-800/80 border-slate-700/50">
          <Sparkles size={16} className="text-nebula-400" />
          <span className="text-sm font-medium">{toast.message}</span>
        </div>
      )}

      <div className="container mx-auto max-w-3xl">
        <header className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-nebula-100 to-nebula-500 cursor-pointer" onClick={() => setFocusedId(null)}>
              Visionary.me
            </h1>
            <p className="text-slate-500 text-[10px] md:text-xs mt-1 uppercase tracking-[0.3em] font-medium flex items-center gap-2">
              Architect of Ambition
            </p>
          </div>
          <Button 
            variant={isVoiceActive ? "voice" : "secondary"} 
            onClick={toggleVoiceMode}
            disabled={isAiDisabled}
            className="rounded-full w-14 h-14 !p-0 shadow-2xl"
          >
            {voiceStatus === VoiceStatus.IDLE ? <Mic size={24} /> : 
             voiceStatus === VoiceStatus.CONNECTING ? <Loader2 className="animate-spin" size={24} /> :
             <MicOff size={24} />}
          </Button>
        </header>

        {isVoiceActive && (
          <div className="mb-10 p-8 glass-panel rounded-3xl flex flex-col items-center justify-center border-nebula-500/20 shadow-2xl scale-in-center">
            <Orb mode={voiceMode} volume={audioVolume} />
            <div className="mt-6 flex flex-col items-center gap-1">
              <span className="text-[11px] text-nebula-400 font-bold uppercase tracking-widest opacity-80">Vision Aligned</span>
              <span className="text-[10px] text-slate-500 font-mono tracking-tighter italic">"Focus on the Peak. I'll handle the Path."</span>
            </div>
          </div>
        )}

        <div className="mb-8 relative group">
          <input 
            value={newTaskTitle}
            onChange={e => setNewTaskTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && newTaskTitle.trim()) { addItem(newTaskTitle.trim(), focusedId || undefined); setNewTaskTitle(''); } }}
            placeholder={focusedId ? `Expanding "${focusedItem?.title}"...` : "What's the next big goal?"}
            className="w-full bg-slate-900/40 border border-slate-700/30 backdrop-blur-xl rounded-2xl py-4 pl-6 pr-16 outline-none focus:ring-2 focus:ring-nebula-500/40 shadow-2xl text-lg placeholder:text-slate-700"
          />
          <button 
            onClick={() => { if (newTaskTitle.trim()) { addItem(newTaskTitle.trim(), focusedId || undefined); setNewTaskTitle(''); } }}
            className="absolute right-3 top-2.5 p-2.5 bg-nebula-600 hover:bg-nebula-500 text-white rounded-xl transition-all shadow-xl active:scale-90"
          >
            <Plus size={24} />
          </button>
        </div>

        {focusedId && breadcrumbs && (
          <nav className="flex items-center flex-wrap gap-2 mb-6 px-2 text-xs md:text-sm text-slate-500 font-medium">
            <button onClick={() => setFocusedId(null)} className="hover:text-nebula-400 flex items-center gap-1">
              <ChevronLeft size={16} /> Summit
            </button>
            {breadcrumbs.slice(0, -1).map(node => (
              <React.Fragment key={node.id}>
                <ChevronRight size={14} className="opacity-30" />
                <button onClick={() => setFocusedId(node.id)} className="hover:text-nebula-400">{node.title}</button>
              </React.Fragment>
            ))}
            <ChevronRight size={14} className="opacity-30" />
            <span className="text-nebula-400 font-bold">{focusedItem?.title}</span>
          </nav>
        )}

        <div className="space-y-4 pb-32">
          {displayItems.map(item => (
            <TaskNode 
              key={item.id} 
              item={item} 
              depth={0} 
              editingId={editingId} 
              editValue={editValue} 
              focusedId={focusedId} 
              setEditValue={setEditValue} 
              saveEdit={saveEdit} 
              startEditing={startEditing} 
              toggleComplete={toggleComplete} 
              setFocusedId={setFocusedId} 
              handleBreakdownNode={handleBreakdownNode} 
              deleteItem={deleteItem} 
              addItem={addItem} 
              setTasks={setTasks}
              isAiDisabled={isAiDisabled}
              activeProvider={lastUsedProvider}
            />
          ))}
          {displayItems.length === 0 && (
            <div className="text-center py-20 flex flex-col items-center gap-3">
              <div className="w-12 h-12 rounded-full border border-slate-800 flex items-center justify-center text-slate-700">
                <Brain size={24} />
              </div>
              <p className="text-slate-700 font-light italic">Define your peak to begin the climb.</p>
            </div>
          )}
        </div>
      </div>
      
      {focusedId && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 animate-fade-in">
          <Button variant="secondary" onClick={() => setFocusedId(null)} icon={Minimize2} className="rounded-full px-8 py-4 shadow-2xl border-nebula-500/50 border-2 text-nebula-100 font-bold">
            Back to Peak
          </Button>
        </div>
      )}

      <style>{`
        @keyframes scale-in-center { 0% { transform: scale(0.9); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
        .scale-in-center { animation: scale-in-center 0.3s cubic-bezier(0.250, 0.460, 0.450, 0.940) both; }
        .animate-fade-in { animation: fadeIn 0.4s ease-out; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
}
