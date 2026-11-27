import fs from 'node:fs/promises';
import path from 'node:path';

const VERSION = 2;

function slimUser(user) {
  return {
    open_id: user.open_id,
    name: typeof user.name === 'string' ? user.name : '',
    employee_no: typeof user.employee_no === 'string' ? user.employee_no : '',
    enterprise_email: typeof user.enterprise_email === 'string' ? user.enterprise_email : '',
    ...(Array.isArray(user.department_ids)
      ? { department_ids: user.department_ids.filter(id => typeof id === 'string') }
      : {}),
    is_frozen: user.is_frozen === true,
    status: user.status && typeof user.status === 'object'
      ? {
          is_resigned: user.status.is_resigned === true,
          is_exited: user.status.is_exited === true,
          is_frozen: user.status.is_frozen === true,
        }
      : undefined,
  };
}

export function createDirectoryCache({
  filePath = null,
  ttlMs = 7 * 24 * 60 * 60 * 1000,
  appId = '',
} = {}) {
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 60_000 || ttlMs > 30 * 24 * 60 * 60 * 1000) {
    throw new RangeError('directoryCacheTtlMs 必须在 1 分钟到 30 天之间');
  }
  if (filePath !== null && (typeof filePath !== 'string' || !filePath.trim())) {
    throw new TypeError('directoryCachePath 必须为非空路径或 null');
  }
  const resolvedPath = filePath ? path.resolve(filePath.trim()) : null;
  let memory = null;
  let writeChain = Promise.resolve();

  async function readDisk() {
    if (!resolvedPath) return null;
    try {
      const raw = await fs.readFile(resolvedPath, 'utf8');
      const payload = JSON.parse(raw);
      if (payload?.version !== VERSION || payload.appId !== appId) return null;
      if (!Number.isFinite(payload.expiresAt) || payload.expiresAt <= Date.now()) return null;
      if (!Array.isArray(payload.users)) return null;
      return { users: payload.users, expiresAt: payload.expiresAt };
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      console.error('directory_cache_read_failed', error.code || error.name);
      return null;
    }
  }

  async function writeDisk(entry) {
    if (!resolvedPath) return;
    const dir = path.dirname(resolvedPath);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const tmp = `${resolvedPath}.${process.pid}.${Date.now()}.tmp`;
    const body = JSON.stringify({
      version: VERSION,
      appId,
      savedAt: Date.now(),
      expiresAt: entry.expiresAt,
      users: entry.users,
    });
    await fs.writeFile(tmp, body, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(tmp, resolvedPath);
    await fs.chmod(resolvedPath, 0o600).catch(() => {});
  }

  return {
    ttlMs,
    filePath: resolvedPath,
    async get() {
      if (memory && memory.expiresAt > Date.now()) return memory.users;
      const disk = await readDisk();
      if (!disk) {
        memory = null;
        return null;
      }
      memory = disk;
      return disk.users;
    },
    async set(users) {
      if (!Array.isArray(users)) throw new TypeError('users 必须为数组');
      const entry = {
        users: users.map(slimUser),
        expiresAt: Date.now() + ttlMs,
      };
      memory = entry;
      writeChain = writeChain.then(() => writeDisk(entry)).catch(error => {
        console.error('directory_cache_write_failed', error.code || error.name);
      });
      await writeChain;
      return entry.users;
    },
    async clear() {
      memory = null;
      if (!resolvedPath) return;
      await fs.unlink(resolvedPath).catch(error => {
        if (error?.code !== 'ENOENT') console.error('directory_cache_clear_failed', error.code || error.name);
      });
    },
  };
}
