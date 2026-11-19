export type Server = {
  pid: number
  ports: number[]
  name: string
  command: string
  /** The project folder this server was started from, when it can be told. */
  project?: string
  parentPid?: number
  parentName?: string
}

export type ProjectRow = {
  path: string
  name: string
  /** What Start runs, or null when nothing runnable was found. */
  command: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'dev-servers': {
      servers: Server[]
      projects: ProjectRow[]
      scannedAt: number
      /** The row a start or stop is in flight for, by path or pid. */
      pending: string[]
    }
  }
}
