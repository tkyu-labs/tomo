export function startPackMirror(packsDir: string): Promise<{ url: string; commit: string; requests: string[]; close(): Promise<void> }>
