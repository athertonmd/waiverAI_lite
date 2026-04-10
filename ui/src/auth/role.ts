export type AppRole = 'admin' | 'user' | null;

export function resolveRole(groups: string[] | undefined): AppRole {
  if (!groups || groups.length === 0) return null;
  const lower = groups.map(g => g.toLowerCase());
  if (lower.includes('admin')) return 'admin';
  if (lower.includes('user')) return 'user';
  return null;
}
