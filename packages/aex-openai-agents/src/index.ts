import path from "node:path";
import { runTask, type ToolRegistry, type RuntimePolicy, type ModelHandler, type RunResult, type RunOptions } from "@aex-lang/runtime";

export interface AEXGuardedAgentOptions {
  /**
   * Absolute or relative path to the .aex task contract.
   */
  taskPath: string;
  /**
   * Tools available to the underlying agent implementation.
   */
  tools: ToolRegistry;
  /**
   * Optional model handler to satisfy `make` steps.
   */
  model?: ModelHandler;
  /**
   * Optional runtime policy applied on top of contract permissions.
   */
  policy?: RuntimePolicy;
  /**
   * Confirmation handler for side-effectful tool calls.
   */
  confirm?: RunOptions["confirm"];
  /**
   * Logger used to stream runtime events (tool calls, confirmations, checks).
   */
  logger?: RunOptions["logger"];
}

/**
 * Wraps an existing agent with AEX enforcement. The adapter delegates execution
 * to the shared runtime so downstream callers only need to provide tools, model
 * hooks, and inputs.
 */
export class AEXGuardedAgent {
  private readonly taskPath: string;

  constructor(private readonly options: AEXGuardedAgentOptions) {
    this.taskPath = path.resolve(process.cwd(), options.taskPath);
  }

  /**
   * Execute the guarded agent with the provided inputs.
   */
  async run(inputs: Record<string, unknown>): Promise<RunResult> {
    return runTask(this.taskPath, {
      inputs,
      tools: this.options.tools,
      model: this.options.model,
      policy: this.options.policy,
      confirm: this.options.confirm,
      logger: this.options.logger,
    });
  }
}
