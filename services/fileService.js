const fs   = require('fs').promises;
const path = require('path');

const ROOT = path.join(__dirname, '..', 'uploads');

const fileService = {
  async save(userId, subpath, buffer, mimeType) {
    const fullPath = path.join(ROOT, String(userId), subpath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, buffer);
    return `${userId}/${subpath}`;
  },

  async read(userId, subpath) {
    const fullPath = path.join(ROOT, String(userId), subpath);
    return fs.readFile(fullPath);
  },

  async delete(userId, subpath) {
    const fullPath = path.join(ROOT, String(userId), subpath);
    await fs.unlink(fullPath).catch(() => {});
  },

  async exists(userId, subpath) {
    const fullPath = path.join(ROOT, String(userId), subpath);
    try {
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  },

  async deleteUserFolder(userId) {
    const base = path.join(ROOT, String(userId));
    await fs.rm(base, { recursive: true, force: true });
  },
};

module.exports = fileService;
