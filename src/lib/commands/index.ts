import { journalCommands } from './journalCommands'
import { propertyCommands } from './propertyCommands'
import { recipeCommands } from './recipeCommands'
import { CommandRegistry } from './registry'
import { templateCommands } from './templateCommands'
import { threadCommands } from './threadCommands'
import { workoutCommands } from './workoutCommands'

export const commandRegistry = new CommandRegistry()
  .registerAll(threadCommands)
  .registerAll(templateCommands)
  .registerAll(propertyCommands)
  .registerAll(journalCommands)
  .registerAll(workoutCommands)
  .registerAll(recipeCommands)

export * from './project'
export * from './registry'
export * from './types'

