export const ROLE_COORDINATOR = "coordinator";
export const ROLE_MEMBER = "member";

export const ROLE_LABELS = {
  [ROLE_COORDINATOR]: "Team Coordinator",
  [ROLE_MEMBER]: "Student Member",
};

export function roleLabel(role) {
  return ROLE_LABELS[role] ?? role;
}
