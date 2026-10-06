export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';

export function isGeminiModel(model) {
  return typeof model === 'string' && /^gemini-[a-z0-9.-]+$/.test(model);
}

export function thinkingConfigFor(model, task = 'reasoning') {
  if (model.startsWith('gemini-2.5-')) {
    return {thinkingBudget: task === 'ocr' ? 0 : task === 'verification' ? 256 : 1024};
  }
  return {thinkingLevel: 'low'};
}
