
/**
 * Interface for Chrome's experimental Built-in AI API.
 * This maps to the `window.ai.languageModel` API.
 */
interface AI {
  languageModel: {
    capabilities: () => Promise<{ available: 'readily' | 'after-download' | 'no' }>;
    create: (options?: any) => Promise<AILanguageModel>;
  };
}

interface AILanguageModel {
  prompt: (input: string) => Promise<string>;
  destroy: () => void;
  clone: () => Promise<AILanguageModel>;
}

declare global {
  interface Window {
    ai?: AI;
  }
}

export const checkLocalAiAvailability = async (): Promise<'readily' | 'after-download' | 'no'> => {
  if (!window.ai || !window.ai.languageModel) return 'no';
  try {
    const capabilities = await window.ai.languageModel.capabilities();
    return capabilities.available;
  } catch (e) {
    console.warn("Local AI capabilities check failed:", e);
    return 'no';
  }
};

export const runLocalPrompt = async (
  systemPrompt: string, 
  userPrompt: string,
  onProgress?: (loaded: number, total: number) => void
): Promise<string> => {
  if (!window.ai) throw new Error("Local AI not supported");

  // Create a session. If 'after-download', this triggers the download.
  const session = await window.ai.languageModel.create({
    systemPrompt: systemPrompt,
    monitor(m: any) {
      m.addEventListener("downloadprogress", (e: any) => {
        if (onProgress) {
          onProgress(e.loaded, e.total);
        }
      });
    }
  });

  try {
    const result = await session.prompt(userPrompt);
    return result;
  } finally {
    session.destroy();
  }
};
