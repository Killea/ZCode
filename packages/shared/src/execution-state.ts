import { z } from "zod";

/** auto 保留为内部权限；plan 仅在旧格式读取边界接受。 */
export const executionPermissionModeSchema = z.enum(["build", "edit", "yolo", "guarded", "auto"]);

/**
 * 新任务缺省权限模式（AppSettings.defaultSessionMode）：只取 composer 可切换的权限档。
 * plan 是独立勾选（阻止编辑）、auto 是内部保留值，都不做缺省候选。
 */
export const zcodeDefaultSessionModeSchema = z.enum(["build", "edit", "guarded", "yolo"]);
export type ZCodeDefaultSessionMode = z.infer<typeof zcodeDefaultSessionModeSchema>;

// ZCodePlus fork 缺省：无 Recent 历史的新任务直接按「完全访问」起稿；上游官方回落 build。
export const DEFAULT_ZCODE_DEFAULT_SESSION_MODE: ZCodeDefaultSessionMode = "yolo";
export const executionStateSchema = z.object({
  mode: executionPermissionModeSchema,
  planEnabled: z.boolean(),
});
export type ExecutionState = z.infer<typeof executionStateSchema>;

/** 在接纳边界固定旧请求语义，不能在队列消费时按当前配置重新解释。 */
export function resolveExecutionState(
  input: { mode?: string; planEnabled?: boolean },
  current: ExecutionState = { mode: "build", planEnabled: false },
): ExecutionState {
  const mode = executionPermissionModeSchema.safeParse(input.mode);
  return {
    mode: mode.success ? mode.data : current.mode,
    planEnabled:
      input.planEnabled ??
      (input.mode === "plan" ? true : mode.success ? false : current.planEnabled),
  };
}
