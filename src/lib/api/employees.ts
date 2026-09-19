// Employees + Roles fetchers — the web half of Flutter `employeesModule.load`
// and `rolesModule.load` (restaurant_owner_app/lib/screens/modules.dart
// ~30515 and ~36405).
//
// The roster read MUST succeed (it throws so useCachedFetch can split outage
// from refusal). Performance and leave are OPTIONAL reads, each gated on its
// own permission + plan feature and fetched separately, so a refusal costs its
// own section and is reported in words — never swallowed into an empty list
// that would read as "no leave".

import { requestBackend } from "@/lib/db";
import type { PasswordResetRequest, RoleDefinition, CoreRoleRow, User } from "@/lib/db";
import { refusalSentence } from "@/lib/error-message";

/** Flutter `_analyticsPermissionId` — gates GET /analytics/staff-performance. */
export const PERM_ANALYTICS = "df75119b-e5f1-4f38-aba5-78a1cf182f56";
/** Flutter `_attendanceReviewPermissionId` — gates GET /leaves + decisions. */
export const PERM_REVIEW_ATTENDANCE = "2e7b9c40-1f83-4d6a-b902-5a8c3e1f6047";

export type Row = Record<string, unknown>;

const throwBackendError = (status: number, text: string, fallback: string): never => {
  if (status === 0) {
    throw new TypeError("Failed to fetch");
  }
  let message = "";
  try {
    message = refusalSentence(JSON.parse(text)) ?? "";
  } catch {
    /* not JSON */
  }
  if (!message) {
    message = text.trim() || fallback;
  }
  throw Object.assign(new Error(message), { status });
};

async function call<T>(
  restaurantId: string,
  method: "GET" | "POST" | "DELETE",
  path: string,
  fallback: string,
  body?: unknown,
  outletId?: string,
): Promise<T | null> {
  const res = await requestBackend<T>({ path, method, restaurantId, outletId, body });
  if (!res.ok) {
    throwBackendError(res.status, res.text, fallback);
  }
  return res.data;
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** An optional section: its payload, or the reason it could not be read. */
export interface OptionalRead {
  data: Row;
  /** '' when read fine. */
  error: string;
}

export interface EmployeesBundle {
  users: User[];
  roles: RoleDefinition[];
  requests: PasswordResetRequest[];
  performance: OptionalRead;
  leaves: OptionalRead;
  canPerf: boolean;
  canLeave: boolean;
}

export async function fetchEmployeesBundle(args: {
  restaurantId: string;
  canPerf: boolean;
  canLeave: boolean;
  canPasswords: boolean;
}): Promise<EmployeesBundle> {
  const { restaurantId, canPerf, canLeave, canPasswords } = args;
  const optional = async (path: string): Promise<OptionalRead> => {
    try {
      const data = await call<Row>(restaurantId, "GET", path, "Couldn't load.");
      return { data: data ?? {}, error: "" };
    } catch (e) {
      return { data: {}, error: errText(e) };
    }
  };
  const [users, roles, requests, performance, leaves] = await Promise.all([
    call<{ users?: User[] }>(restaurantId, "GET", "/restaurant/users", "Couldn't load the team."),
    call<RoleDefinition[]>(restaurantId, "GET", "/roles", "").catch(() => [] as RoleDefinition[]),
    canPasswords
      ? call<{ requests?: PasswordResetRequest[] }>(restaurantId, "GET", "/restaurant/password-requests", "").catch(() => null)
      : Promise.resolve(null),
    canPerf ? optional("/analytics/staff-performance?days=30") : Promise.resolve({ data: {}, error: "" }),
    // meta=1 for the envelope (and its window); 500 = the server's own cap.
    canLeave ? optional("/leaves?meta=1&limit=500") : Promise.resolve({ data: {}, error: "" }),
  ]);
  return {
    users: Array.isArray(users?.users) ? users.users : [],
    roles: Array.isArray(roles) ? roles : [],
    requests: Array.isArray(requests?.requests) ? requests.requests : [],
    performance,
    leaves,
    canPerf,
    canLeave,
  };
}

/** POST /leaves — `emp_id` omitted when filing for yourself (no permission needed). */
export async function requestLeave(
  restaurantId: string,
  body: { emp_id?: string; leave_type: string; start_day: string; end_day: string; reason?: string },
): Promise<void> {
  await call(restaurantId, "POST", "/leaves", "Couldn't file the leave.", body);
}

/** POST /leaves/:id/approve|reject — returns whether anything changed. */
export async function decideLeave(restaurantId: string, id: string, approve: boolean): Promise<boolean> {
  const res = await call<Row>(
    restaurantId,
    "POST",
    `/leaves/${encodeURIComponent(id)}/${approve ? "approve" : "reject"}`,
    "Couldn't record the decision.",
  );
  return res?.changed !== false;
}

export async function assignRole(restaurantId: string, employeeId: string, roleName: string): Promise<void> {
  await call(restaurantId, "POST", "/roles/assign", "Couldn't assign the role.", { employeeId, role_name: roleName });
}

export async function unassignRole(restaurantId: string, employeeId: string, roleName: string): Promise<void> {
  await call(restaurantId, "POST", "/roles/remove", "Couldn't remove the role.", { employeeId, role_name: roleName });
}

export async function removeEmployee(restaurantId: string, employeeId: string): Promise<void> {
  await call(restaurantId, "DELETE", "/restaurant/users", "Couldn't remove the employee.", { employeeId });
}

export async function addEmployee(
  restaurantId: string,
  outletId: string | undefined,
  body: { emp_Fname: string; emp_Lname: string; username: string; password: string; email?: string; role: string },
): Promise<void> {
  await call(restaurantId, "POST", "/restaurant/users", "Couldn't add the employee.", body, outletId);
}

// ---------------------------------------------------------------- roles

export interface ActionGroup {
  group: string;
  actions: { id: string; name: string; desc?: string | null }[];
}

export interface RolesBundle {
  roles: RoleDefinition[];
  actions: ActionGroup[];
  /** Empty when GET /core-roles failed or predates — the chips go inert. */
  core: CoreRoleRow[];
}

const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

function toAction(v: unknown): { id: string; name: string; desc: string | null } {
  const a = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const desc = str(a.action_desc) || str(a.desc);
  return { id: str(a.id), name: str(a.action_name) || str(a.name), desc: desc || null };
}

/**
 * GET /actions answers a FLAT list of `{id, action_name, action_desc, group}`.
 * Callers want groups, in the order the server first names them. An
 * already-grouped `{group, actions: [...]}` answer is accepted as well.
 */
function groupActions(raw: unknown): ActionGroup[] {
  if (!Array.isArray(raw)) { return []; }
  const groups = new Map<string, ActionGroup>();
  const push = (group: string, action: { id: string; name: string; desc: string | null }): void => {
    if (!action.id) { return; }
    let g = groups.get(group);
    if (!g) {
      g = { group, actions: [] };
      groups.set(group, g);
    }
    g.actions.push(action);
  };
  for (const item of raw as unknown[]) {
    const r = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const group = str(r.group) || "Other";
    if (Array.isArray(r.actions)) {
      for (const a of r.actions as unknown[]) { push(group, toAction(a)); }
    } else {
      push(group, toAction(r));
    }
  }
  return [...groups.values()];
}

export async function fetchRolesBundle(restaurantId: string, canSeeActions: boolean): Promise<RolesBundle> {
  const [roles, actions, core] = await Promise.all([
    call<RoleDefinition[]>(restaurantId, "GET", "/roles", "Couldn't load the roles."),
    canSeeActions
      ? call<unknown>(restaurantId, "GET", "/actions", "").catch(() => [] as unknown)
      : Promise.resolve([] as unknown),
    call<CoreRoleRow[]>(restaurantId, "GET", "/core-roles", "").catch(() => [] as CoreRoleRow[]),
  ]);
  return {
    roles: Array.isArray(roles) ? roles : [],
    actions: groupActions(actions),
    core: Array.isArray(core) ? core : [],
  };
}

/** POST /roles — creates, or rewrites an existing role of that name. */
export async function saveRole(restaurantId: string, roleName: string, actionIds: string[]): Promise<void> {
  await call(restaurantId, "POST", "/roles", "Couldn't save the role.", {
    role_name: roleName,
    actions_performable: actionIds,
  });
}

export async function deleteRoleById(restaurantId: string, id: string): Promise<void> {
  await call(restaurantId, "DELETE", `/roles/${encodeURIComponent(id)}`, "Couldn't delete the role.");
}
