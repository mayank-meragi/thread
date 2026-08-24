import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createGoogle } from '@ai-sdk/google'
import type { LanguageModel } from 'ai'

const STORAGE_KEY = 'thread.ai'

export type AIProvider = 'anthropic' | 'openai' | 'google'

export interface AIConfig {
  provider: AIProvider
  apiKey: string
  model: string
}

export function getAIConfig(): AIConfig | null {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as AIConfig
  } catch {
    return null
  }
}

export function saveAIConfig(config: AIConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  window.dispatchEvent(new Event('thread:ai-config'))
}

export function clearAIConfig(): void {
  localStorage.removeItem(STORAGE_KEY)
  window.dispatchEvent(new Event('thread:ai-config'))
}

// Switching providers is entirely a config change -- this is the one place
// that branches on which provider is selected. `ai`'s streamText/tool calls
// elsewhere never need to know which provider produced the model.
export function resolveModel(config: AIConfig): LanguageModel {
  if (config.provider === 'anthropic') {
    // Anthropic's API rejects direct browser calls unless this header is
    // present -- the same "bring your own key, call it from the client"
    // trust model this app already uses for GitHub sync.
    const anthropic = createAnthropic({
      apiKey: config.apiKey,
      headers: { 'anthropic-dangerous-direct-browser-access': 'true' },
    })
    return anthropic(config.model)
  }
  if (config.provider === 'google') {
    const google = createGoogle({ apiKey: config.apiKey })
    return google(config.model)
  }
  const openai = createOpenAI({ apiKey: config.apiKey })
  return openai(config.model)
}
