const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const clone = value => value === undefined ? undefined : structuredClone(value);

function mergeValue(base, local, remote, path, conflicts) {
  if (same(local, base)) return clone(remote);
  if (same(remote, base) || same(local, remote)) return clone(local);
  if (Array.isArray(base) && Array.isArray(local) && Array.isArray(remote)) {
    const key = path === 'applications'
      ? item => `${item.projectId}:${item.employeeId}`
      : ['projects', 'tickets', 'records', 'employees', 'applicationEvents'].includes(path)
        ? item => String(item.id) : null;
    if (key) {
      const byKey = list => new Map(list.map(item => [key(item), item]));
      const prior = byKey(base), mine = byKey(local), theirs = byKey(remote);
      const result = [];
      for (const id of new Set([...theirs.keys(), ...mine.keys(), ...prior.keys()])) {
        const merged = mergeValue(prior.get(id), mine.get(id), theirs.get(id), `${path}:${id}`, conflicts);
        if (merged !== undefined) result.push(merged);
      }
      return result;
    }
  }
  if (base && local && remote && !Array.isArray(base) && !Array.isArray(local) && !Array.isArray(remote)
      && typeof base === 'object' && typeof local === 'object' && typeof remote === 'object') {
    const result = {};
    for (const key of new Set([...Object.keys(remote), ...Object.keys(local), ...Object.keys(base)])) {
      const merged = mergeValue(base[key], local[key], remote[key], path ? `${path}.${key}` : key, conflicts);
      if (merged !== undefined) result[key] = merged;
    }
    return result;
  }
  conflicts.push(path);
  return clone(local);
}

export function mergeOperatorPayload(base, local, remote) {
  if (!base || !local || !remote) return {payload:null, conflicts:['기준 버전 없음']};
  const conflicts = [];
  const payload = mergeValue(base, local, remote, '', conflicts);
  return {payload:conflicts.length ? null : payload, conflicts};
}
