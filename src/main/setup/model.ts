import type { RpcPeer } from '../hermes/rpc'
import { REASONING_EFFORT, type Reasoning } from './providers'

/** Model & usage page: switch model / thinking level through the gateway (methods_config_set.py). */
/** Needs a live session (the gateway refuses otherwise); `--global` also makes it the profile default. */
export async function setModel(rpc: RpcPeer, sessionId: string, model: string, provider: string): Promise<void> {
  await rpc.request('config.set', { key: 'model', session_id: sessionId, value: `${model} --provider ${provider} --global`, scope: 'global', confirm_expensive_model: true })
}

export async function setReasoning(rpc: RpcPeer, level: Reasoning): Promise<void> {
  await rpc.request('config.set', { key: 'reasoning', value: REASONING_EFFORT[level], scope: 'global' })
}

/** Models offered for the configured providers (the current provider first). */
export async function listModels(rpc: RpcPeer): Promise<{ provider?: string; model?: string; models: string[] }> {
  const res = await rpc.request('model.options', { explicit_only: true })
  const current = res.providers.find((p) => p.is_current) ?? res.providers[0]
  return { provider: res.provider, model: res.model, models: current?.models ?? [] }
}
