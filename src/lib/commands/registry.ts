import type { CommandDefinition, CommandExecutionContext, CommandMetadata, CommandResolutionContext, PreparedCommand } from './types'

export class CommandRegistry {
  private readonly commands = new Map<string, CommandDefinition>()

  register(command: CommandDefinition): this {
    if (this.commands.has(command.name)) throw new Error(`Command ${command.name} is already registered.`)
    this.commands.set(command.name, command)
    return this
  }

  registerAll(commands: readonly CommandDefinition[]): this {
    commands.forEach((command) => this.register(command))
    return this
  }

  get(name: string): CommandDefinition | undefined {
    return this.commands.get(name)
  }

  require(name: string): CommandDefinition {
    const command = this.get(name)
    if (!command) throw new Error(`Unknown command ${name}.`)
    return command
  }

  list(): CommandMetadata[] {
    return Array.from(this.commands.values(), ({ name, summary, category, keywords, example, risk, idempotency, queryArgumentPaths }) => ({
      name,
      summary,
      category,
      keywords,
      example,
      risk,
      idempotency,
      queryArgumentPaths,
    })).sort((a, b) => a.name.localeCompare(b.name))
  }

  async prepare(name: string, rawInput: unknown, context: CommandResolutionContext = {}): Promise<PreparedCommand> {
    const command = this.require(name)
    const input = command.inputSchema.parse(rawInput)
    const resolved = await command.resolve(input, context)
    const preview = await command.preview(resolved)
    return {
      capability: name,
      input,
      resolved,
      preview,
      risk: command.risk,
      idempotency: command.idempotency,
    }
  }

  async execute(prepared: PreparedCommand, context: CommandExecutionContext): Promise<unknown> {
    return this.require(prepared.capability).execute(prepared.resolved, context)
  }
}
