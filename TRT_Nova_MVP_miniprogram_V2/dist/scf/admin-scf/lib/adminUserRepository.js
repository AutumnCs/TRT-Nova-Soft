export function createAdminUserRepository({ db }) {
  return {
    async findByUsername(username) {
      const [rows] = await db.execute(
        `SELECT id, username, password_hash AS passwordHash, role, status
         FROM admin_users WHERE username = ? LIMIT 1`,
        [username]
      );
      return rows[0] || null;
    }
  };
}
