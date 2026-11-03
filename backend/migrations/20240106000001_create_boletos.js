/**
 * Compatibility shim for environments whose knex_migrations history
 * already includes this file name from an older branch.
 *
 * DDA storage now lives in later migrations, so this file is a no-op.
 */

exports.up = async function () {
  // Intentionally empty.
};

exports.down = async function () {
  // Intentionally empty.
};
